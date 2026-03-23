/**
 * Post-posting invariants inside MongoDB transactions (same session as voucher + bank).
 * Rollback entire transaction if GL vs operational cash/bank diverges or BS does not tie.
 */

const Voucher = require("../models/Voucher");
const BankAccount = require("../models/BankAccount");
const { buildAccountMap, round } = require("../controllers/reportController");

const BANK_GL_EPS = 1;
const BS_EPS = 0.02;

function computeBankGlFromMap(map) {
  let glCash = 0;
  let glBank = 0;
  for (const row of map.values()) {
    if (row.account === "Cash") glCash = Number(row.balance) || 0;
    else if (row.account === "Bank") glBank = Number(row.balance) || 0;
  }
  return { glCash, glBank, glTotal: round(glCash + glBank) };
}

function balanceSheetGapFromMap(map) {
  let cash = 0;
  let ar = 0;
  let oa = 0;
  let gstPay = 0;
  let oliab = 0;
  let rev = 0;
  let exp = 0;
  let re = 0;
  for (const row of map.values()) {
    if (row.type === "asset") {
      if (row.account === "Cash") cash = row.balance;
      else if (row.account === "Accounts Receivable") ar = row.balance;
      else oa += row.balance;
    }
    if (row.type === "liability") {
      if (row.account === "GST Payable") gstPay = -row.balance;
      else oliab += -row.balance;
    }
    if (row.type === "equity") re += -row.balance;
    if (row.type === "revenue") rev += row.credit - row.debit;
    if (row.type === "expense") exp += row.debit - row.credit;
  }
  const cyProfit = round(rev - exp);
  const te = round(re + cyProfit);
  const ta = round(cash + ar + oa);
  const tl = round(gstPay + oliab);
  const lpe = round(tl + te);
  return round(ta - lpe);
}

async function computeOpsTotal(session) {
  let q = BankAccount.find({}).select("name balance");
  if (session) q = q.session(session);
  const bankAccs = await q.lean();
  const opsCashRow = bankAccs.find((b) => b.name === "Cash");
  const opsBankRows = bankAccs.filter((b) => b.name !== "Cash");
  const opsCashBal = opsCashRow ? Number(opsCashRow.balance) || 0 : 0;
  const opsBankBal = opsBankRows.reduce((s, b) => s + (Number(b.balance) || 0), 0);
  return round(opsCashBal + opsBankBal);
}

async function assertNoNegativeOperationalBalances(session) {
  let q = BankAccount.find({}).select("name balance");
  if (session) q = q.session(session);
  const rows = await q.lean();
  for (const b of rows) {
    if (Number(b.balance) < -BS_EPS) {
      const e = new Error(`Negative operational balance on ${b.name}: ${round(b.balance)}`);
      e.code = "ACCOUNTING_INVARIANT_NEGATIVE_BANK";
      e.status = 400;
      throw e;
    }
  }
}

/**
 * @param {import("mongoose").Types.ObjectId|string} financialYearId
 * @param {import("mongoose").ClientSession|null} session
 */
async function assertPostTransactionAccountingInvariants(financialYearId, session) {
  if (!financialYearId) {
    const e = new Error("Active financial year is required for accounting invariants");
    e.code = "ACCOUNTING_INVARIANT_FY";
    e.status = 400;
    throw e;
  }

  let vq = Voucher.find({ financialYearId }).select("_id");
  if (session) vq = vq.session(session);
  const voucherRows = await vq.lean();
  const voucherIds = voucherRows.map((v) => v._id);

  const map = await buildAccountMap(voucherIds, financialYearId, { session });
  const { glTotal } = computeBankGlFromMap(map);
  const opsTotal = await computeOpsTotal(session);

  if (Math.abs(opsTotal - glTotal) > BANK_GL_EPS) {
    const e = new Error(
      `Bank–GL mismatch after posting: operational=${opsTotal} GL Cash+Bank=${glTotal}`,
    );
    e.code = "ACCOUNTING_INVARIANT_BANK_GL";
    e.status = 503;
    e.metrics = { opsTotal, glTotal, delta: round(opsTotal - glTotal) };
    throw e;
  }

  const gap = balanceSheetGapFromMap(map);
  if (Math.abs(gap) > BS_EPS) {
    const e = new Error(
      `Balance sheet not balanced after posting: Assets−(Liabilities+Equity)=${gap}`,
    );
    e.code = "ACCOUNTING_INVARIANT_BALANCE_SHEET";
    e.status = 503;
    e.metrics = { gap };
    throw e;
  }

  await assertNoNegativeOperationalBalances(session);
}

module.exports = {
  assertPostTransactionAccountingInvariants,
  computeBankGlFromMap,
  balanceSheetGapFromMap,
};
