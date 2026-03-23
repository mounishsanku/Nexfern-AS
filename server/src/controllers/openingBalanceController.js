const mongoose = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const OpeningBalance = require("../models/OpeningBalance");
const VoucherEntry = require("../models/VoucherEntry");
const Voucher = require("../models/Voucher");
const Account = require("../models/Account");
const FinancialYear = require("../models/FinancialYear");
const { signedOpeningAmount, splitClosingToDebitCredit, round2 } = require("../utils/openingBalanceUtils");

function round(n) {
  return round2(n);
}

function obSetPayload(debit, credit) {
  const d = Math.max(0, round(debit));
  const c = Math.max(0, round(credit));
  return {
    debit: d,
    credit: c,
    debitAmount: d,
    creditAmount: c,
    amount: round(d - c),
  };
}

async function assertFinancialYearOpen(financialYearId) {
  if (!financialYearId || !mongoose.Types.ObjectId.isValid(String(financialYearId))) {
    return { ok: false, status: 400, body: { message: "financialYearId is required", code: "FY_REQUIRED" } };
  }
  const fy = await FinancialYear.findById(financialYearId).lean();
  if (!fy) return { ok: false, status: 404, body: { message: "Financial year not found", code: "FY_NOT_FOUND" } };
  if (fy.isClosed) {
    return {
      ok: false,
      status: 403,
      body: { message: "Cannot modify opening balances for a closed financial year", code: "FY_LOCKED" },
    };
  }
  return { ok: true, fy };
}

// ---------------------------------------------------------------------------
// POST /api/opening-balances
// Body: { financialYearId, items: [{ accountId, debit, credit }] }
// Or: query financialYearId + JSON array body [{ accountId, debit, credit }]
// Legacy: single { accountId, financialYearId, debitAmount, creditAmount, amount }
// ---------------------------------------------------------------------------

async function upsertOpeningBalances(req, res) {
  try {
    const raw = req.body ?? {};
    let financialYearId = raw.financialYearId ?? req.query.financialYearId;
    let items = raw.items ?? raw.balances;

    if (Array.isArray(raw) && raw.length && typeof raw[0] === "object") {
      items = raw;
      financialYearId = financialYearId ?? req.query.financialYearId;
    }

    if (!items && raw.accountId) {
      items = [
        {
          accountId: raw.accountId,
          debit: raw.debit ?? raw.debitAmount,
          credit: raw.credit ?? raw.creditAmount,
        },
      ];
      financialYearId = financialYearId ?? raw.financialYearId;
    }

    const gate = await assertFinancialYearOpen(financialYearId);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    if (!Array.isArray(items)) {
      return res.status(400).json({
        message: "Expected items array: [{ accountId, debit, credit }] or legacy single account payload",
        code: "OPENING_BALANCE_ITEMS_REQUIRED",
      });
    }

    const results = [];
    for (const row of items) {
      const accountId = row.accountId;
      const debit = Number(row.debit ?? row.debitAmount) || 0;
      const credit = Number(row.credit ?? row.creditAmount) || 0;

      if (!accountId || !mongoose.Types.ObjectId.isValid(String(accountId))) {
        return res.status(400).json({ message: "Each item needs a valid accountId", code: "OPENING_BALANCE_ACCOUNT_INVALID" });
      }
      if (debit < 0 || credit < 0) {
        return res.status(400).json({ message: "debit and credit must be ≥ 0", code: "OPENING_BALANCE_NEGATIVE" });
      }
      if (debit > 0 && credit > 0) {
        return res.status(400).json({
          message: "Provide either debit or credit per account, not both",
          code: "OPENING_BALANCE_BOTH_SIDES",
        });
      }

      const account = await Account.findById(accountId).lean();
      if (!account) {
        return res.status(404).json({ message: `Account not found: ${accountId}`, code: "ACCOUNT_NOT_FOUND" });
      }

      if (debit === 0 && credit === 0) {
        const existed = await OpeningBalance.findOne({ accountId, financialYearId }).select("_id").lean();
        if (!existed) {
          continue;
        }
        await OpeningBalance.deleteOne({ accountId, financialYearId });
        continue;
      }

      const payload = obSetPayload(debit, credit);
      const doc = await OpeningBalance.findOneAndUpdate(
        { accountId, financialYearId },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      results.push(doc);
    }

    return res.status(200).json({ count: results.length, balances: results });
  } catch (err) {
    console.error("upsertOpeningBalances error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate opening balance row", code: "OPENING_BALANCE_DUPLICATE" });
    }
    return sendStructuredError(res, {
      code: "OPENING_BALANCE_UPSERT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/opening-balances?financialYearId=...
// ---------------------------------------------------------------------------

async function listOpeningBalances(req, res) {
  try {
    const { financialYearId } = req.query ?? {};
    if (!financialYearId || !mongoose.Types.ObjectId.isValid(String(financialYearId))) {
      return res.status(400).json({
        message: "Query parameter financialYearId is required",
        code: "FY_REQUIRED",
      });
    }

    const balances = await OpeningBalance.find({ financialYearId })
      .populate("accountId", "name type")
      .populate("financialYearId", "name isClosed")
      .lean();

    return res.json(balances);
  } catch (err) {
    console.error("listOpeningBalances error:", err);
    return sendStructuredError(res, {
      code: "OPENING_BALANCE_LIST_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

// ---------------------------------------------------------------------------
// carryForward(fromFYId, toFYId)
// Closing (debit − credit convention) from prior FY → new FY as debit OR credit.
// P&L nets into Retained Earnings. Balance-sheet rows with only opening (no vouchers) carry forward.
// ---------------------------------------------------------------------------

async function ensureRetainedEarningsAccount() {
  let acc = await Account.findOne({ name: "Retained Earnings" }).lean();
  if (!acc) {
    const created = await Account.create({ name: "Retained Earnings", type: "equity", isActive: true });
    acc = typeof created.toObject === "function" ? created.toObject() : created;
  }
  return acc;
}

async function carryForward(fromFYId, toFYId) {
  const fromStr = String(fromFYId);
  const toStr = String(toFYId);

  const vouchers = await Voucher.find({ financialYearId: fromStr }).select("_id").lean();
  const voucherIds = vouchers.map((v) => v._id);

  const totals = new Map();
  if (voucherIds.length > 0) {
    const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
      .populate({ path: "accountId", select: "name type" })
      .lean();

    for (const e of entries) {
      if (!e.accountId) continue;
      const key = String(e.accountId._id);
      if (!totals.has(key)) {
        totals.set(key, {
          accountId: e.accountId._id,
          name: e.accountId.name,
          type: e.accountId.type,
          debit: 0,
          credit: 0,
        });
      }
      const row = totals.get(key);
      row.debit += Number(e.debit) || 0;
      row.credit += Number(e.credit) || 0;
    }
  }

  const prevOpeningBalances = await OpeningBalance.find({ financialYearId: fromStr }).lean();
  const prevOBMap = new Map(
    prevOpeningBalances.map((ob) => [String(ob.accountId), signedOpeningAmount(ob)]),
  );

  const allIds = new Set([...totals.keys(), ...prevOBMap.keys()]);
  if (allIds.size === 0) {
    console.log("carryForward: no prior-year opening rows or voucher activity — nothing to carry.");
    return;
  }

  const accounts = await Account.find({ _id: { $in: [...allIds] } }).lean();
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  let plToRetained = 0;
  for (const row of totals.values()) {
    if (row.type === "revenue") plToRetained += (row.credit - row.debit);
    if (row.type === "expense") plToRetained -= (row.debit - row.credit);
  }

  const reAccount = await ensureRetainedEarningsAccount();
  const reKey = String(reAccount._id);

  const ops = [];

  for (const id of allIds) {
    const acc = accountById.get(id);
    if (!acc) continue;
    if (acc.type === "revenue" || acc.type === "expense") continue;
    if (id === reKey) continue;

    const prev = prevOBMap.get(id) ?? 0;
    const t = totals.get(id);
    const netM = t ? t.debit - t.credit : 0;
    const closing = round(prev + netM);
    const { debit, credit } = splitClosingToDebitCredit(closing);
    ops.push({
      updateOne: {
        filter: { accountId: acc._id, financialYearId: toStr },
        update: { $set: obSetPayload(debit, credit) },
        upsert: true,
      },
    });
  }

  const prevRE = prevOBMap.get(reKey) ?? 0;
  const rowRE = totals.get(reKey);
  const netRE = rowRE ? rowRE.debit - rowRE.credit : 0;
  const closingRE = round(prevRE + netRE + plToRetained);
  const reSplit = splitClosingToDebitCredit(closingRE);
  const reMaterial =
    Math.abs(closingRE) > 1e-6 ||
    Math.abs(plToRetained) > 1e-6 ||
    Math.abs(prevRE) > 1e-6 ||
    Math.abs(netRE) > 1e-6;
  if (reMaterial) {
    ops.push({
      updateOne: {
        filter: { accountId: reAccount._id, financialYearId: toStr },
        update: { $set: obSetPayload(reSplit.debit, reSplit.credit) },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    await OpeningBalance.bulkWrite(ops);
  }

  console.log(
    `carryForward: ${ops.length} opening-balance row(s) for FY ${toStr} from prior FY ${fromStr}. P&L to retained: ${round(plToRetained)}`,
  );
}

module.exports = {
  upsertOpeningBalances,
  listOpeningBalances,
  carryForward,
};
