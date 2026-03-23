const mongoose = require("mongoose");
const Expense = require("../models/Expense");
const Account = require("../models/Account");
const VoucherEntry = require("../models/VoucherEntry");
const { recordBankTransaction } = require("../services/bankService");
const { createVoucherForTdsPayment } = require("../services/voucherService");
const { logAction, ACTIONS, buildMetadata } = require("../utils/audit");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { sendInternalError, sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

async function computeTdsPayable() {
  const tdsAccount = await Account.findOne({ name: "TDS Payable" }).lean();
  if (!tdsAccount) return 0;

  const agg = await VoucherEntry.aggregate([
    { $match: { accountId: tdsAccount._id } },
    {
      $group: {
        _id: null,
        totalCredit: { $sum: "$credit" },
        totalDebit: { $sum: "$debit" },
      },
    },
  ]);
  if (!agg[0]) return 0;
  return Math.max(0, Number(agg[0].totalCredit || 0) - Number(agg[0].totalDebit || 0));
}

// GET /api/tds — lightweight summary (same auth as report)
async function getTdsApiInfo(_req, res) {
  try {
    const tdsPayable = await computeTdsPayable();
    return res.json({
      ok: true,
      tdsPayable,
      endpoints: {
        report: "GET /api/tds/report",
        pay: "POST /api/tds/pay",
      },
    });
  } catch (err) {
    console.error("getTdsApiInfo error:", err);
    return sendInternalError(res, err, { code: "TDS_FAILED", action: ACTION.RETRY });
  }
}

// GET /api/tds/report
async function getTdsReport(_req, res) {
  try {
    const expenses = await Expense.find({
      status: "approved",
      tdsApplicable: true,
      tdsAmount: { $gt: 0 },
    })
      .populate("vendorId", "name email gstNumber")
      .sort({ date: -1 })
      .lean();

    const totalTds = await computeTdsPayable();
    const records = expenses.map((e) => ({
      expenseId: e._id,
      vendorId: e.vendorId?._id ?? null,
      vendorName: e.vendorId?.name ?? "-",
      vendorEmail: e.vendorId?.email ?? null,
      vendorGstNumber: e.vendorId?.gstNumber ?? null,
      amount: Number(e.amount) || 0,
      tdsAmount: Number(e.tdsAmount) || 0,
      date: e.date,
    }));

    const byVendor = new Map();
    for (const r of records) {
      const key = String(r.vendorId ?? "unassigned");
      if (!byVendor.has(key)) {
        byVendor.set(key, {
          vendorId: r.vendorId,
          vendorName: r.vendorName,
          vendorEmail: r.vendorEmail,
          vendorGstNumber: r.vendorGstNumber,
          totalBaseAmount: 0,
          totalTds: 0,
          deductionsCount: 0,
        });
      }
      const row = byVendor.get(key);
      row.totalBaseAmount += Number(r.amount) || 0;
      row.totalTds += Number(r.tdsAmount) || 0;
      row.deductionsCount += 1;
    }
    const vendorSummary = [...byVendor.values()]
      .map((v) => ({
        ...v,
        totalBaseAmount: Math.round(Number(v.totalBaseAmount) * 100) / 100,
        totalTds: Math.round(Number(v.totalTds) * 100) / 100,
      }))
      .sort((a, b) => b.totalTds - a.totalTds);

    return res.json({
      totalTds,
      records,
      vendorSummary,
      export: {
        headers: [
          "vendorName",
          "vendorEmail",
          "vendorGstNumber",
          "expenseId",
          "amount",
          "tdsAmount",
          "date",
        ],
        rows: records.map((r) => ({
          vendorName: r.vendorName,
          vendorEmail: r.vendorEmail,
          vendorGstNumber: r.vendorGstNumber,
          expenseId: String(r.expenseId),
          amount: Math.round(Number(r.amount) * 100) / 100,
          tdsAmount: Math.round(Number(r.tdsAmount) * 100) / 100,
          date: r.date,
        })),
      },
    });
  } catch (err) {
    console.error("getTdsReport error:", err);
    return sendInternalError(res, err, { code: "TDS_FAILED", action: ACTION.RETRY });
  }
}

// POST /api/tds/pay
async function payTds(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { amount, method = "cash", bankAccountId = null } = req.body ?? {};
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "amount must be > 0", code: "TDS_AMOUNT_INVALID" });
    }
    const normalizedMethod = String(method).toLowerCase();
    if (!["cash", "bank"].includes(normalizedMethod)) {
      return res.status(400).json({ message: "method must be cash or bank", code: "TDS_METHOD_INVALID" });
    }

    const payable = await computeTdsPayable();
    if (payable <= 0) {
      return res.status(400).json({
        message: "No TDS payable balance — nothing to remit",
        code: "TDS_PAYABLE_ZERO",
      });
    }
    if (parsedAmount > payable) {
      return res.status(400).json({
        message: "amount exceeds TDS payable",
        code: "TDS_AMOUNT_EXCEEDS_PAYABLE",
      });
    }

    const financialYearId = req.activeYear?._id ?? null;
    if (!financialYearId) {
      return res.status(400).json({
        message: "Active financial year is required",
        code: "ACTIVE_FY_REQUIRED",
      });
    }

    const session = await mongoose.startSession();
    let voucher = null;

    try {
      await session.withTransaction(async () => {
        const result = await createVoucherForTdsPayment({
          amount: parsedAmount,
          financialYearId,
          paymentAccount: normalizedMethod === "bank" ? "Bank" : "Cash",
          bankAccountId: bankAccountId && mongoose.Types.ObjectId.isValid(String(bankAccountId))
            ? bankAccountId
            : null,
          session,
        });
        voucher = result.voucher;
        if (result.alreadyExisted) {
          const err = new Error("TDS payment already processed");
          err.code = "ALREADY_PROCESSED";
          throw err;
        }
        await recordBankTransaction({
          bankAccountId: bankAccountId ?? null,
          type: "debit",
          amount: parsedAmount,
          referenceType: "tds_payment",
          referenceId: voucher.referenceId ?? voucher._id,
          session,
        });
        await assertPostTransactionAccountingInvariants(financialYearId, session);
      });
    } catch (err) {
      if (err?.code === "ALREADY_PROCESSED") {
        return sendStructuredError(res, {
          status: 409,
          code: "ALREADY_PROCESSED",
          message: "TDS payment already processed",
          action: ACTION.FIX_REQUIRED,
        });
      }
      if (err?.code === "INSUFFICIENT_FUNDS") {
        return sendStructuredError(res, {
          status: 400,
          code: "INSUFFICIENT_FUNDS",
          message: err.message || "Insufficient funds",
          action: ACTION.RETRY,
        });
      }
      if (
        err?.code === "BANK_GL_BLOCK" ||
        err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
        err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET" ||
        err?.code === "ACCOUNTING_INVARIANT_NEGATIVE_BANK"
      ) {
        return sendStructuredError(res, {
          status: err.status || 503,
          code: err.code,
          message: err.message || "Accounting check failed",
          action: ACTION.RETRY,
          details: err.metrics,
        });
      }
      throw err;
    } finally {
      await session.endSession();
    }

    await logAction(
      userId,
      ACTIONS.CREATE,
      "tds_payment",
      voucher._id,
      buildMetadata(null, { amount: parsedAmount })
    );

    return res.status(201).json({ message: "TDS payment recorded", voucherId: voucher._id });
  } catch (err) {
    console.error("payTds error:", err);
    return sendInternalError(res, err, {
      code: err?.code && String(err.code) !== "Error" ? String(err.code) : "TDS_FAILED",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { getTdsApiInfo, getTdsReport, payTds };
