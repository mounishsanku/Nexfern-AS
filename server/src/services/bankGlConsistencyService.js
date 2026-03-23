/**
 * Operational BankAccount wallets vs GL "Cash" + "Bank" (VoucherEntry-derived).
 * Pre-posting guard blocks cash/bank mutations when misaligned after auto-adjust.
 */

const mongoose = require("mongoose");
const BankAccount = require("../models/BankAccount");
const BankTransaction = require("../models/BankTransaction");
const Account = require("../models/Account");
const { buildAccountMap, resolveFilter, round } = require("../controllers/reportController");
const { createVoucher } = require("./voucherService");

/** Rupee tolerance */
const BANK_GL_EPS = 1;

const SUSPENSE_NAME = "Suspense (Adjustment Account)";
const OWNER_CAPITAL = "Owner's Capital";

function bankGlBlockError(diff) {
  const e = new Error(
    `GL Cash+Bank does not match operational wallets (Δ=${round(diff.delta)}). Posting blocked until aligned.`,
  );
  e.code = "BANK_GL_BLOCK";
  e.status = 503;
  e.metrics = { delta: diff.delta };
  return e;
}

async function ensureSuspenseAccount() {
  await Account.updateOne(
    { name: SUSPENSE_NAME },
    { $setOnInsert: { name: SUSPENSE_NAME, type: "liability", isActive: true } },
    { upsert: true },
  );
}

async function ensureOwnerCapitalAccount() {
  await Account.updateOne(
    { name: OWNER_CAPITAL },
    { $setOnInsert: { name: OWNER_CAPITAL, type: "equity", isActive: true } },
    { upsert: true },
  );
}

/**
 * @returns {{ glCash: number, glBank: number, glTotal: number, opsCashBal: number, opsBankBal: number, opsTotal: number, delta: number }}
 */
async function computeBankGlDiff() {
  const bankAccs = await BankAccount.find({}).select("name balance").lean();
  const { voucherIds, financialYearId } = await resolveFilter({});
  const map = await buildAccountMap(voucherIds, financialYearId);
  let glCash = 0;
  let glBank = 0;
  for (const row of map.values()) {
    if (row.account === "Cash") glCash = Number(row.balance) || 0;
    else if (row.account === "Bank") glBank = Number(row.balance) || 0;
  }
  const opsCashRow = bankAccs.find((b) => b.name === "Cash");
  const opsBankRows = bankAccs.filter((b) => b.name !== "Cash");
  const opsCashBal = opsCashRow ? Number(opsCashRow.balance) || 0 : 0;
  const opsBankBal = opsBankRows.reduce((s, b) => s + (Number(b.balance) || 0), 0);
  const glTotal = glCash + glBank;
  const opsTotal = opsCashBal + opsBankBal;
  return {
    glCash,
    glBank,
    glTotal,
    opsCashBal,
    opsBankBal,
    opsTotal,
    delta: round(opsTotal - glTotal),
  };
}

/**
 * Signed net from BankTransaction: credits increase wallet, debits decrease (all accounts).
 */
async function computeBankTransactionNetTotal() {
  const agg = await BankTransaction.aggregate([
    {
      $group: {
        _id: null,
        credits: { $sum: { $cond: [{ $eq: [{ $toLower: "$type" }, "credit"] }, "$amount", 0] } },
        debits: { $sum: { $cond: [{ $eq: [{ $toLower: "$type" }, "debit"] }, "$amount", 0] } },
      },
    },
  ]);
  const row = agg[0];
  if (!row) return 0;
  return round(Number(row.credits || 0) - Number(row.debits || 0));
}

async function createBankGlAdjustmentVoucher(financialYearId) {
  if (!financialYearId) {
    return { adjusted: false };
  }
  const diff = await computeBankGlDiff();
  const delta = round(diff.delta);
  if (Math.abs(delta) <= BANK_GL_EPS) {
    return { adjusted: false };
  }

  await ensureSuspenseAccount();

  const absAmt = round(Math.abs(delta));
  if (absAmt <= BANK_GL_EPS) {
    return { adjusted: false };
  }

  const entries =
    delta > 0
      ? [
          { account: "Cash", debit: absAmt, credit: 0 },
          { account: SUSPENSE_NAME, debit: 0, credit: absAmt },
        ]
      : [
          { account: SUSPENSE_NAME, debit: absAmt, credit: 0 },
          { account: "Cash", debit: 0, credit: absAmt },
        ];

  const { voucher } = await createVoucher({
    type: "adjustment",
    narration: `Bank–GL alignment (ops ${round(diff.opsTotal)} vs GL ${round(diff.glTotal)})`,
    financialYearId,
    referenceType: "bank_gl_adjustment",
    referenceId: new mongoose.Types.ObjectId(),
    entries,
  });

  return { adjusted: true, voucher };
}

/**
 * Before any cash/bank-affecting mutation: align GL to wallets or throw BANK_GL_BLOCK.
 */
async function assertBankGlAlignedBeforePosting(financialYearId) {
  if (!financialYearId) return;
  let diff = await computeBankGlDiff();
  if (Math.abs(diff.delta) <= BANK_GL_EPS) return;
  await createBankGlAdjustmentVoucher(financialYearId);
  diff = await computeBankGlDiff();
  if (Math.abs(diff.delta) > BANK_GL_EPS) {
    throw bankGlBlockError(diff);
  }
}

/**
 * Operational wallets still negative: GL Dr Cash/Bank, Cr Owner's Capital; reset wallet to 0.
 */
async function repairNegativeOperationalWithCapital(financialYearId) {
  if (!financialYearId) return { repaired: 0 };
  await ensureOwnerCapitalAccount();
  const neg = await BankAccount.find({ balance: { $lt: -BANK_GL_EPS } }).lean();
  let repaired = 0;
  for (const b of neg) {
    const bal = Number(b.balance) || 0;
    if (bal >= -BANK_GL_EPS) continue;
    const inject = round(-bal);
    const glName = b.name === "Cash" ? "Cash" : "Bank";
    await createVoucher({
      type: "adjustment",
      narration: `Capital injection — restore non-negative balance on ${b.name}`,
      financialYearId,
      referenceType: "capital_injection",
      referenceId: new mongoose.Types.ObjectId(),
      entries: [
        { account: glName, debit: inject, credit: 0 },
        { account: OWNER_CAPITAL, debit: 0, credit: inject },
      ],
    });
    await BankAccount.updateOne({ _id: b._id }, { $set: { balance: 0 } });
    repaired += 1;
  }
  return { repaired };
}

/**
 * Balance sheet plug (minimal): only posts when |gap| is material; uses Suspense ↔ Retained Earnings.
 * Retained Earnings must exist (seeded with chart).
 */
async function createBalanceSheetPlugIfNeeded(financialYearId) {
  if (!financialYearId) return { plugged: false, gap: 0 };

  const { voucherIds } = await resolveFilter({});
  const map = await buildAccountMap(voucherIds, financialYearId);

  let cash = 0;
  let accountsReceivable = 0;
  let otherAssets = 0;
  let gstPayable = 0;
  let otherLiabilities = 0;
  let revenue = 0;
  let expenses = 0;
  let retainedEarnings = 0;

  for (const row of map.values()) {
    if (row.type === "asset") {
      if (row.account === "Cash") cash = row.balance;
      else if (row.account === "Accounts Receivable") accountsReceivable = row.balance;
      else otherAssets += row.balance;
    }
    if (row.type === "liability") {
      if (row.account === "GST Payable") gstPayable = -row.balance;
      else otherLiabilities += -row.balance;
    }
    if (row.type === "equity") retainedEarnings += -row.balance;
    if (row.type === "revenue") revenue += row.credit - row.debit;
    if (row.type === "expense") expenses += row.debit - row.credit;
  }

  const currentYearProfit = round(revenue - expenses);
  const totalEquity = round(retainedEarnings + currentYearProfit);
  const totalAssets = round(cash + accountsReceivable + otherAssets);
  const totalLiabilities = round(gstPayable + otherLiabilities);
  const liabilitiesPlusEquity = round(totalLiabilities + totalEquity);
  const gap = round(totalAssets - liabilitiesPlusEquity);

  if (Math.abs(gap) <= 0.02) {
    return { plugged: false, gap: 0 };
  }

  await ensureSuspenseAccount();
  let re = await Account.findOne({ name: "Retained Earnings" }).select("_id").lean();
  if (!re) {
    await Account.create({ name: "Retained Earnings", type: "equity", isActive: true });
    re = await Account.findOne({ name: "Retained Earnings" }).select("_id").lean();
  }

  const absG = round(Math.abs(gap));
  const entries =
    gap > 0
      ? [
          { account: "Retained Earnings", debit: 0, credit: absG },
          { account: SUSPENSE_NAME, debit: absG, credit: 0 },
        ]
      : [
          { account: SUSPENSE_NAME, debit: 0, credit: absG },
          { account: "Retained Earnings", debit: absG, credit: 0 },
        ];

  await createVoucher({
    type: "adjustment",
    narration: `Balance sheet plug (gap ${round(gap)})`,
    financialYearId,
    referenceType: "bs_plug",
    referenceId: new mongoose.Types.ObjectId(),
    entries,
  });

  return { plugged: true, gap };
}

/**
 * Run bank–GL alignment up to `maxPasses` times (handles rounding after multiple adjustments).
 */
async function runBankGlAlignmentLoop(financialYearId, maxPasses = 5) {
  let passes = 0;
  for (let i = 0; i < maxPasses; i++) {
    const diff = await computeBankGlDiff();
    if (Math.abs(diff.delta) <= BANK_GL_EPS) break;
    await createBankGlAdjustmentVoucher(financialYearId);
    passes += 1;
  }
  const diff = await computeBankGlDiff();
  return { passes, diff };
}

async function reconcileBankGlAfterPosting(financialYearId) {
  if (!financialYearId) {
    return { ok: true, adjusted: false, diff: await computeBankGlDiff() };
  }

  let diff = await computeBankGlDiff();
  if (Math.abs(diff.delta) <= BANK_GL_EPS) {
    return { ok: true, adjusted: false, diff };
  }

  const { adjusted } = await createBankGlAdjustmentVoucher(financialYearId);
  diff = await computeBankGlDiff();

  if (Math.abs(diff.delta) > BANK_GL_EPS) {
    return {
      ok: false,
      adjusted,
      diff,
      code: "BANK_GL_MISMATCH",
    };
  }

  return { ok: true, adjusted, diff };
}

module.exports = {
  BANK_GL_EPS,
  SUSPENSE_NAME,
  computeBankGlDiff,
  computeBankTransactionNetTotal,
  createBankGlAdjustmentVoucher,
  assertBankGlAlignedBeforePosting,
  repairNegativeOperationalWithCapital,
  createBalanceSheetPlugIfNeeded,
  runBankGlAlignmentLoop,
  reconcileBankGlAfterPosting,
};
