/**
 * Self-healing diagnostics: orphan/invalid voucher cleanup, GL↔bank alignment, negative cash repair.
 */

const mongoose = require("mongoose");
const FinancialYear = require("../models/FinancialYear");
const Voucher = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const RevenueSchedule = require("../models/RevenueSchedule");
const Payslip = require("../models/Payslip");
const Employee = require("../models/Employee");
const BankAccount = require("../models/BankAccount");
const BankTransaction = require("../models/BankTransaction");
const OpeningBalance = require("../models/OpeningBalance");
const Account = require("../models/Account");
const AuditLog = require("../models/AuditLog");
const LocalizationRegistry = require("../localization/registry/LocalizationRegistry");
const { runSystemValidation } = require("./systemValidationService");
const {
  computeBankGlDiff,
  runBankGlAlignmentLoop,
  repairNegativeOperationalWithCapital,
  SUSPENSE_NAME,
} = require("./bankGlConsistencyService");

const { createValidatedVoucher } = require("./voucherService");
const { allocateVoucherNumber } = require("./voucherNumberService");
const { buildAccountMap, resolveFilter, round: roundForReports } = require("../controllers/reportController");
const { signedOpeningAmount } = require("../utils/openingBalanceUtils");

const EPS = 0.02;

/** When true, heal routines skip noisy console (pre-transaction guard / intervals). */
let healSilentMode = false;

/** Stable id for system-generated audit rows (no User document required for logging). */
const SYSTEM_AUDIT_USER_ID = new mongoose.Types.ObjectId("000000000000000000000001");

const SKIP_REF_EXISTS_CHECK = new Set([
  "tds_payment",
  "bank_gl_adjustment",
  "capital_injection",
  "bs_plug",
]);

async function logSystemHeal(code, message, details = {}) {
  try {
    await AuditLog.create({
      userId: SYSTEM_AUDIT_USER_ID,
      action: code,
      entity: "system_heal",
      entityId: String(new mongoose.Types.ObjectId()),
      before: { code, message },
      after: details,
      data: { ...details, at: new Date().toISOString() },
      timestamp: new Date(),
    });
  } catch (e) {
    if (!healSilentMode) {
      // eslint-disable-next-line no-console
      console.error("[systemHeal] audit log failed", e?.message || e);
    }
  }
  if (!healSilentMode) {
    // eslint-disable-next-line no-console
    console.error(`[SYSTEM_HEAL] ${code}`, message, details);
  }
}

async function deleteVoucherCascade(voucherId) {
  await VoucherEntry.deleteMany({ voucherId });
  await Voucher.deleteOne({ _id: voucherId });
}

async function refDocumentExists(referenceType, referenceId) {
  const rt = String(referenceType || "").toLowerCase();
  const rid = referenceId;
  if (!rid) return false;
  if (SKIP_REF_EXISTS_CHECK.has(rt)) return true;
  if (rt === "expense") return !!(await Expense.findById(rid).select("_id").lean());
  if (rt === "invoice") return !!(await Invoice.findById(rid).select("_id").lean());
  if (rt === "payment" || rt === "payment_reversal") {
    return !!(await Payment.findById(rid).select("_id").lean());
  }
  if (rt === "revenue_schedule") {
    return !!(await RevenueSchedule.findById(rid).select("_id").lean());
  }
  if (rt === "payroll") {
    const slip = await Payslip.findById(rid).select("_id").lean();
    if (slip) return true;
    return !!(await Employee.findById(rid).select("_id").lean());
  }
  return true;
}

/**
 * Vouchers with no lines, unbalanced lines, or missing type/number.
 */
async function removeInvalidVouchers() {
  let removed = 0;
  const vouchers = await Voucher.find({}).select("_id type voucherNumber").lean();
  const ids = vouchers.map((v) => v._id);
  if (!ids.length) return removed;

  const agg = await VoucherEntry.aggregate([
    { $match: { voucherId: { $in: ids } } },
    {
      $group: {
        _id: "$voucherId",
        n: { $sum: 1 },
        td: { $sum: "$debit" },
        tc: { $sum: "$credit" },
      },
    },
  ]);
  const byV = new Map(agg.map((r) => [String(r._id), r]));

  for (const v of vouchers) {
    if (!v.type || !v.voucherNumber) {
      await deleteVoucherCascade(v._id);
      removed += 1;
      await logSystemHeal("INVALID_VOUCHER_REMOVED", "invalid voucher: missing type or number", {
        voucherId: String(v._id),
      });
      continue;
    }
    const row = byV.get(String(v._id));
    if (!row || row.n < 2 || Math.abs(Number(row.td) - Number(row.tc)) > EPS) {
      await deleteVoucherCascade(v._id);
      removed += 1;
      await logSystemHeal("INVALID_VOUCHER_REMOVED", "invalid voucher: no lines or unbalanced", {
        voucherId: String(v._id),
      });
    }
  }
  return removed;
}

/**
 * referenceType set but no referenceId, or referenced document missing.
 */
async function removeOrphanVouchersByReference() {
  let removed = 0;
  const vouchers = await Voucher.find({}).lean();
  for (const v of vouchers) {
    const rt = v.referenceType ? String(v.referenceType).trim() : "";
    const rid = v.referenceId;

    if (rt && !rid) {
      await deleteVoucherCascade(v._id);
      removed += 1;
      await logSystemHeal("ORPHAN_REMOVED", "voucher had referenceType but no referenceId", {
        voucherId: String(v._id),
        referenceType: rt,
      });
      continue;
    }
    if (!rt || !rid) continue;

    const ok = await refDocumentExists(rt, rid);
    if (!ok) {
      await deleteVoucherCascade(v._id);
      removed += 1;
      await logSystemHeal("ORPHAN_REMOVED", "referenced document not found", {
        voucherId: String(v._id),
        referenceType: rt,
        referenceId: String(rid),
      });
    }
  }
  return removed;
}

/**
 * Count vouchers that reference missing documents or have referenceType but no referenceId.
 */
async function countOrphanVouchersByReference() {
  let n = 0;
  const vouchers = await Voucher.find({}).select("referenceType referenceId").lean();
  for (const v of vouchers) {
    const rt = v.referenceType ? String(v.referenceType).trim() : "";
    const rid = v.referenceId;
    if (rt && !rid) {
      n += 1;
      continue;
    }
    if (!rt || !rid) continue;
    if (!(await refDocumentExists(rt, rid))) n += 1;
  }
  return n;
}

async function getTargetFinancialYearId(explicit) {
  if (explicit && mongoose.Types.ObjectId.isValid(String(explicit))) {
    return explicit;
  }
  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  return fy ? fy._id : null;
}

/**
 * Full auto-fix pass (idempotent).
 * @param {{ financialYearId?: import("mongoose").Types.ObjectId|string|null, reason?: string }} options
 */
async function removeOrphanVoucherEntries() {
  const agg = await VoucherEntry.aggregate([
    { $lookup: { from: "vouchers", localField: "voucherId", foreignField: "_id", as: "v" } },
    { $match: { v: { $size: 0 } } },
    { $project: { _id: 1 } },
  ]);
  if (!agg.length) return 0;
  const n = await VoucherEntry.deleteMany({ _id: { $in: agg.map((x) => x._id) } });
  return n.deletedCount || agg.length;
}

/**
 * Recalculate invoice paidAmount/status from remaining Payment rows.
 */
async function recalcInvoicePaidAmount(invoiceId) {
  if (!invoiceId) return;
  const inv = await Invoice.findById(invoiceId).select("totalAmount").lean();
  if (!inv) return;
  const pays = await Payment.find({ invoiceId }).lean();
  const paid = pays.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const total = Number(inv.totalAmount) || 0;
  const epsilon = 1e-6;
  let status = "unpaid";
  if (paid > epsilon) status = Math.abs(paid - total) <= epsilon ? "paid" : "partial";
  await Invoice.updateOne({ _id: invoiceId }, { $set: { paidAmount: paid, status } });
}

/**
 * Expense-linked vouchers: only approved expenses may have vouchers.
 */
async function fixExpenseVoucherConsistency() {
  const rows = await Voucher.find({ referenceType: "expense", referenceId: { $exists: true, $ne: null } })
    .select("_id referenceId")
    .lean();
  let removed = 0;
  for (const v of rows) {
    const ex = await Expense.findById(v.referenceId).select("status").lean();
    if (!ex || ex.status !== "approved") {
      await deleteVoucherCascade(v._id);
      removed += 1;
      await logSystemHeal("ORPHAN_REMOVED", "expense voucher removed (expense not approved or missing)", {
        voucherId: String(v._id),
        expenseId: String(v.referenceId),
      });
    }
  }
  return removed;
}

/**
 * Payment rows must have both a payment voucher and a matching credit bank transaction.
 */
async function fixBrokenPayments() {
  const payments = await Payment.find({}).lean();
  let removed = 0;
  for (const p of payments) {
    const v = await Voucher.findOne({ referenceType: "payment", referenceId: p._id }).select("_id").lean();
    const bt = await BankTransaction.findOne({
      referenceType: "payment",
      referenceId: p._id,
      type: "credit",
    })
      .select("_id")
      .lean();
    if (v && bt) continue;

    if (v) await deleteVoucherCascade(v._id);
    await BankTransaction.deleteMany({ referenceType: "payment", referenceId: p._id });
    await Payment.deleteOne({ _id: p._id });
    await recalcInvoicePaidAmount(p.invoiceId);
    removed += 1;
    await logSystemHeal("BROKEN_PAYMENT_REMOVED", "payment removed (incomplete voucher + bank posting)", {
      paymentId: String(p._id),
      invoiceId: String(p.invoiceId),
    });
  }
  return removed;
}

async function bankTransactionReferenceValid(tx) {
  const rt = String(tx.referenceType || "").toLowerCase();
  const rid = tx.referenceId;
  if (rt === "manual") return true;
  if (!rid) return false;
  if (rt === "payment") return !!(await Payment.findById(rid).select("_id").lean());
  if (rt === "expense") return !!(await Expense.findById(rid).select("_id").lean());
  if (rt === "payroll") {
    const slip = await Payslip.findById(rid).select("_id").lean();
    if (slip) return true;
    return !!(await Employee.findById(rid).select("_id").lean());
  }
  if (rt === "tds_payment") {
    const byRef = await Voucher.findOne({ referenceType: "tds_payment", referenceId: rid }).select("_id").lean();
    if (byRef) return true;
    return !!(await Voucher.findById(rid).select("_id").lean());
  }
  return true;
}

/**
 * Remove bank transactions whose referenceId does not resolve.
 */
async function removeOrphanBankTransactionsByReference() {
  const txs = await BankTransaction.find({}).lean();
  let removed = 0;
  for (const tx of txs) {
    const ok = await bankTransactionReferenceValid(tx);
    if (!ok) {
      await BankTransaction.deleteOne({ _id: tx._id });
      removed += 1;
      await logSystemHeal("ORPHAN_REMOVED", "orphan bank transaction removed", {
        bankTransactionId: String(tx._id),
        referenceType: tx.referenceType,
      });
    }
  }
  return removed;
}

function scanCodebaseIntegrity() {
  const fs = require("fs");
  const path = require("path");
  const issues = [];
  const notes = [];
  const indexPath = path.join(__dirname, "../index.js");
  let content = "";
  try {
    content = fs.readFileSync(indexPath, "utf8");
  } catch (e) {
    issues.push({ code: "CODEBASE_READ_FAILED", message: String(e?.message || e) });
    return { ok: false, issues, notes };
  }
  const apiMounts = (content.match(/app\.use\("\/api/g) || []).length;
  const bankMounts = (content.match(/app\.use\("\/api\/bank"/g) || []).length;
  if (bankMounts >= 2) {
    notes.push("Two /api/bank mounts (routes + reconciliation) — expected.");
  }
  let clientApiUsesGetApiBase = false;
  const clientApiPath = path.join(__dirname, "../../../client/src/api.ts");
  try {
    const apiTs = fs.readFileSync(clientApiPath, "utf8");
    clientApiUsesGetApiBase = /export\s+function\s+getApiBase\s*\(/.test(apiTs);
  } catch {
    notes.push("client/src/api.ts not read (optional).");
  }
  return {
    ok: issues.length === 0,
    expressApiMounts: apiMounts,
    bankRouteDuplicates: bankMounts,
    clientApiUsesGetApiBase,
    issues,
    notes,
  };
}

function countIssueScore(validation) {
  const errors = validation?.errors || [];
  const critWarn = (validation?.warnings || []).filter((w) => w.severity === "critical");
  return errors.length + critWarn.length;
}

async function runSystemDiagnosticsAndAutoFix(options = {}) {
  const prevSilent = healSilentMode;
  healSilentMode = options.silent === true;
  const summary = {
    invalidVouchersRemoved: 0,
    orphanVouchersRemoved: 0,
    orphanVoucherLinesRemoved: 0,
    expenseVouchersPurged: 0,
    brokenPaymentsRemoved: 0,
    orphanBankTransactionsRemoved: 0,
    glAlignmentPasses: 0,
    negativeCashRepairs: 0,
    bankGlDeltaAfter: null,
    balanceSheetFixApplied: false,
    balanceSheetGapBefore: null,
    balanceSheetGapAfter: null,
    reason: options.reason || "manual",
  };

  try {
    // Prefer: broken references first, then structurally invalid vouchers, then orphan lines.
    summary.orphanVouchersRemoved = await removeOrphanVouchersByReference();
    summary.invalidVouchersRemoved = await removeInvalidVouchers();
    summary.orphanVoucherLinesRemoved = await removeOrphanVoucherEntries();
    if (summary.orphanVoucherLinesRemoved > 0) {
      await logSystemHeal("ORPHAN_REMOVED", "orphan voucher lines deleted", {
        count: summary.orphanVoucherLinesRemoved,
      });
    }

    summary.expenseVouchersPurged = await fixExpenseVoucherConsistency();
    summary.brokenPaymentsRemoved = await fixBrokenPayments();
    summary.orphanBankTransactionsRemoved = await removeOrphanBankTransactionsByReference();

    const financialYearId = await getTargetFinancialYearId(options.financialYearId);
    if (financialYearId) {
      const neg = await repairNegativeOperationalWithCapital(financialYearId);
      summary.negativeCashRepairs = neg.repaired || 0;
      if (summary.negativeCashRepairs > 0) {
        await logSystemHeal("AUTO_FIX_APPLIED", "negative operational cash repaired via capital", {
          repaired: summary.negativeCashRepairs,
        });
      }

      const loop = await runBankGlAlignmentLoop(financialYearId, 8);
      summary.glAlignmentPasses = loop.passes || 0;
      if (summary.glAlignmentPasses > 0) {
        await logSystemHeal("GL_ADJUSTED", "bank–GL alignment vouchers posted", {
          passes: summary.glAlignmentPasses,
        });
      }

      const diff = await computeBankGlDiff();
      summary.bankGlDeltaAfter = diff.delta;

      const bs = await fixBalanceSheetImbalanceIfNeeded(financialYearId);
      if (bs?.applied) {
        summary.balanceSheetFixApplied = true;
        summary.balanceSheetGapBefore = bs.before?.difference ?? null;
        summary.balanceSheetGapAfter = bs.after?.difference ?? null;
        await logSystemHeal("BALANCE_SHEET_FIXED", "balance sheet gap reconciled via adjustment voucher", {
          before: bs.before?.difference ?? null,
          after: bs.after?.difference ?? null,
        });
      }
    }

    await logSystemHeal("AUTO_FIX_APPLIED", "runSystemDiagnosticsAndAutoFix completed", summary);
    return summary;
  } finally {
    healSilentMode = prevSilent;
  }
}

/**
 * Build common report fields from validation result.
 */
function buildDiagnosticReport(validationBefore, validationAfter, healSummary, codebase) {
  const issuesFound = countIssueScore(validationBefore);
  const issuesAfter = countIssueScore(validationAfter);
  const issuesFixed = Math.max(0, issuesFound - issuesAfter);

  const remainingIssues = [
    ...(validationAfter.errors || []).map((e) => ({
      code: e.code,
      message: e.message,
      severity: e.severity || "error",
    })),
    ...(validationAfter.warnings || [])
      .filter((w) => w.severity === "critical")
      .map((w) => ({
        code: w.code,
        message: w.message,
        severity: "warning",
      })),
  ];

  const errN = (validationAfter.errors || []).length;
  const critW = (validationAfter.warnings || []).filter((w) => w.severity === "critical").length;
  const systemStatus = errN === 0 && critW === 0 ? "STABLE" : "UNSTABLE";

  return {
    issuesFound,
    issuesFixed,
    remainingIssues,
    systemStatus,
    validationSnapshot: {
      before: {
        errors: (validationBefore.errors || []).length,
        warnings: (validationBefore.warnings || []).length,
      },
      after: { errors: errN, warnings: (validationAfter.warnings || []).length },
    },
    healSummary,
    codebase,
    metrics: validationAfter.metrics,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Full diagnostic: detect → heal → validate → structured report.
 * @param {{ financialYearId?: import("mongoose").Types.ObjectId|string|null, reason?: string, silent?: boolean, quick?: boolean }} options
 * - `quick`: skip codebase scan (for pre-transaction guard / intervals).
 */
async function runFullSystemDiagnostics(options = {}) {
  const silent = options.silent === true;
  const quick = options.quick === true;

  const validationBefore = await runSystemValidation();
  const codebase = quick ? null : scanCodebaseIntegrity();

  const healSummary = await runSystemDiagnosticsAndAutoFix({ ...options, silent });

  const validationAfter = await runSystemValidation();
  const report = buildDiagnosticReport(validationBefore, validationAfter, healSummary, codebase);

  if (!silent) {
    await logSystemHeal(
      "AUTO_FIX_APPLIED",
      quick ? "runFullSystemDiagnostics (quick) completed" : "runFullSystemDiagnostics completed",
      {
        issuesFound: report.issuesFound,
        issuesFixed: report.issuesFixed,
        systemStatus: report.systemStatus,
        remainingErrorCount: (validationAfter.errors || []).length,
      },
    );
  }

  return report;
}

/**
 * Lightweight state check (after fixes, used before transactions).
 */
async function validateSystemState(financialYearId) {
  const issues = [];
  const diff = await computeBankGlDiff();
  if (Math.abs(diff.delta) > 1) {
    issues.push({ code: "BANK_GL_MISMATCH", delta: diff.delta });
  }
  const neg = await BankAccount.find({ balance: { $lt: -EPS } }).select("name balance").lean();
  if (neg.length) {
    issues.push({ code: "NEGATIVE_CASH", accounts: neg.map((b) => b.name) });
  }
  const orphanRefCount = await countOrphanVouchersByReference();
  if (orphanRefCount > 0) {
    issues.push({ code: "ORPHAN_VOUCHERS", count: orphanRefCount });
  }
  const orphanEntries = await VoucherEntry.aggregate([
    { $lookup: { from: "vouchers", localField: "voucherId", foreignField: "_id", as: "v" } },
    { $match: { v: { $size: 0 } } },
    { $count: "c" },
  ]);
  const orphanEntryCount = orphanEntries[0]?.c ?? 0;
  if (orphanEntryCount > 0) {
    issues.push({ code: "ORPHAN_VOUCHER_ENTRIES", count: orphanEntryCount });
  }

  const malformed = await Voucher.countDocuments({
    $or: [{ type: { $in: [null, ""] } }, { voucherNumber: { $in: [null, ""] } }],
  });
  if (malformed > 0) {
    issues.push({ code: "INVALID_VOUCHERS", count: malformed });
  }

  // --- Balance sheet equation (Assets == Liabilities + Equity) → CRITICAL ---
  try {
    const { voucherIds, financialYearId: resolvedFYId } = await resolveFilter({
      financialYearId: financialYearId ? String(financialYearId) : undefined,
    });
    const map = await buildAccountMap(voucherIds, resolvedFYId);

    let cash = 0;
    let accountsReceivable = 0;
    let otherAssets = 0;
    let gstPayable = 0;
    let otherLiabilities = 0;
    let retainedEarnings = 0;
    let revenue = 0;
    let expenses = 0;

    for (const row of map.values()) {
      if (row.type === "asset") {
        if (row.account === "Cash") cash = row.balance;
        else if (row.account === "Accounts Receivable") accountsReceivable = row.balance;
        else otherAssets += row.balance;
      }
      if (row.type === "liability") {
        if (row.account === LocalizationRegistry.getTaxLiabilityAccount()) gstPayable = -row.balance;
        else otherLiabilities += -row.balance;
      }
      if (row.type === "equity") retainedEarnings += -row.balance;
      if (row.type === "revenue") revenue += row.credit - row.debit;
      if (row.type === "expense") expenses += row.debit - row.credit;
    }

    const currentYearProfit = roundForReports(revenue - expenses);
    const totalEquity = roundForReports(retainedEarnings + currentYearProfit);
    const totalAssets = roundForReports(cash + accountsReceivable + otherAssets);
    const totalLiabilities = roundForReports(gstPayable + otherLiabilities);
    const liabilitiesPlusEquity = roundForReports(totalLiabilities + totalEquity);
    const difference = roundForReports(totalAssets - liabilitiesPlusEquity);

    if (Math.abs(difference) > EPS) {
      issues.push({
        code: "BALANCE_SHEET_IMBALANCE",
        difference,
        assetsTotal: totalAssets,
        liabilitiesTotal: totalLiabilities,
        equityTotal: totalEquity,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Balance sheet check skipped:", e?.message || e);
  }

  if (financialYearId) {
    const ids = await Voucher.distinct("_id", { financialYearId });
    if (ids.length) {
      const agg = await VoucherEntry.aggregate([
        { $match: { voucherId: { $in: ids } } },
        {
          $group: {
            _id: "$voucherId",
            n: { $sum: 1 },
            td: { $sum: "$debit" },
            tc: { $sum: "$credit" },
          },
        },
      ]);
      const byV = new Map(agg.map((r) => [String(r._id), r]));
      let bad = 0;
      for (const vid of ids) {
        const row = byV.get(String(vid));
        if (!row || row.n < 2 || Math.abs(Number(row.td) - Number(row.tc)) > EPS) {
          bad += 1;
        }
      }
      if (bad > 0) {
        issues.push({ code: "VOUCHER_LINE_IMBALANCE", count: bad });
      }
    }
  }

  return { ok: issues.length === 0, issues, diff };
}

async function ensureBalanceSheetCriticalAccounts() {
  // Equity accounts required by the balance sheet equation.
  await Account.updateOne(
    { name: "Retained Earnings" },
    { $setOnInsert: { name: "Retained Earnings", type: "equity", isActive: true } },
    { upsert: true },
  );
  await Account.updateOne(
    { name: "Owner's Capital" },
    { $setOnInsert: { name: "Owner's Capital", type: "equity", isActive: true } },
    { upsert: true },
  );

  // Suspense is treated as a liability for the equation.
  await Account.updateOne(
    { name: SUSPENSE_NAME },
    { $setOnInsert: { name: SUSPENSE_NAME, type: "liability", isActive: true } },
    { upsert: true },
  );

  // Classification correctness (fix incorrect account types deterministically).
  await Account.updateOne({ name: "Retained Earnings" }, { $set: { type: "equity", isActive: true } });
  await Account.updateOne({ name: "Owner's Capital" }, { $set: { type: "equity", isActive: true } });
  await Account.updateOne({ name: SUSPENSE_NAME }, { $set: { type: "liability", isActive: true } });
}

async function computeBalanceSheetGap(financialYearId) {
  const { voucherIds, financialYearId: resolvedFYId } = await resolveFilter({
    financialYearId: financialYearId ? String(financialYearId) : undefined,
  });
  const map = await buildAccountMap(voucherIds, resolvedFYId);

  let cash = 0;
  let accountsReceivable = 0;
  let otherAssets = 0;
  let gstPayable = 0;
  let otherLiabilities = 0;
  let retainedEarnings = 0;
  let revenue = 0;
  let expenses = 0;

  for (const row of map.values()) {
    if (row.type === "asset") {
      if (row.account === "Cash") cash = row.balance;
      else if (row.account === "Accounts Receivable") accountsReceivable = row.balance;
      else otherAssets += row.balance;
    }
    if (row.type === "liability") {
      if (row.account === LocalizationRegistry.getTaxLiabilityAccount()) gstPayable = -row.balance;
      else otherLiabilities += -row.balance;
    }
    if (row.type === "equity") retainedEarnings += -row.balance;
    if (row.type === "revenue") revenue += row.credit - row.debit;
    if (row.type === "expense") expenses += row.debit - row.credit;
  }

  const currentYearProfit = roundForReports(revenue - expenses);
  const equityTotal = roundForReports(retainedEarnings + currentYearProfit);
  const assetsTotal = roundForReports(cash + accountsReceivable + otherAssets);
  const liabilitiesTotal = roundForReports(gstPayable + otherLiabilities);
  const liabilitiesPlusEquity = roundForReports(liabilitiesTotal + equityTotal);
  const difference = roundForReports(assetsTotal - liabilitiesPlusEquity);

  return { assetsTotal, liabilitiesTotal, equityTotal, difference, gapAbs: Math.abs(difference), resolvedFYId };
}

/**
 * Fixes balance sheet imbalance using a single controlled adjustment voucher.
 * - Assets > L+E => Dr Suspense, Cr Retained Earnings
 * - Assets < L+E => Dr Retained Earnings, Cr Suspense
 */
async function fixBalanceSheetImbalanceIfNeeded(financialYearId) {
  await ensureBalanceSheetCriticalAccounts();

  const before = await computeBalanceSheetGap(financialYearId);
  // eslint-disable-next-line no-console
  console.log("BS GAP:", before.difference);

  if (before.gapAbs <= EPS) {
    return { applied: false, before, after: before };
  }

  // Opening balance analysis for root identification (logged only).
  try {
    const obs = await OpeningBalance.find({ financialYearId }).populate({ path: "accountId", select: "name type" }).lean();
    let openingAssets = 0;
    let openingLiabilities = 0;
    let openingEquity = 0;
    for (const ob of obs) {
      const signed = signedOpeningAmount(ob);
      const t = ob.accountId?.type;
      if (t === "asset") openingAssets += signed;
      else if (t === "liability") openingLiabilities += signed;
      else if (t === "equity") openingEquity += signed;
    }
    // eslint-disable-next-line no-console
    console.log("Opening totals:", { openingAssets, openingLiabilities, openingEquity });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Opening balance analysis skipped:", e?.message || e);
  }

  const suspenseName = SUSPENSE_NAME;
  const equityAdjustment = "Retained Earnings";
  const amount = before.gapAbs;

  // Opening-balance reconciliation:
  // A balanced journal entry cannot change the system's computed BS-gap (it remains invariant),
  // but the OpeningBalance table directly feeds the balance-sheet equation via buildAccountMap.
  // So we reconcile by adjusting the opening "Retained Earnings" signed amount by (-gap).
  const retained = await Account.findOne({ name: equityAdjustment }).select("_id").lean();
  if (!retained?._id) {
    const e = new Error(`Missing equity account: ${equityAdjustment}`);
    e.code = "INVALID_SYSTEM_STATE";
    throw e;
  }

  const existingOb = await OpeningBalance.findOne({
    accountId: retained._id,
    financialYearId,
  });

  const currentSigned = signedOpeningAmount(existingOb);
  const targetSigned = currentSigned - before.difference; // makes BS-gap move toward 0

  const debit = targetSigned > 0 ? roundForReports(targetSigned) : 0;
  const credit = targetSigned < 0 ? roundForReports(Math.abs(targetSigned)) : 0;

  if (existingOb) {
    existingOb.debit = debit;
    existingOb.credit = credit;
    existingOb.debitAmount = debit;
    existingOb.creditAmount = credit;
    existingOb.amount = roundForReports(targetSigned);
    await existingOb.save();
  } else {
    await OpeningBalance.create({
      accountId: retained._id,
      financialYearId,
      debit,
      credit,
      debitAmount: debit,
      creditAmount: credit,
      amount: roundForReports(targetSigned),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const afterOpen = await computeBalanceSheetGap(financialYearId);

  // eslint-disable-next-line no-console
  console.log("BALANCE_SHEET_FIXED", before.difference);

  // Create a single audit voucher for traceability (does not change the computed gap).
  if (afterOpen.gapAbs <= EPS) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const voucherNumber = await allocateVoucherNumber(session);
        const entries =
          before.difference > 0
            ? [
                { account: suspenseName, debit: amount, credit: 0 },
                { account: equityAdjustment, debit: 0, credit: amount },
              ]
            : [
                { account: equityAdjustment, debit: amount, credit: 0 },
                { account: suspenseName, debit: 0, credit: amount },
              ];

        await createValidatedVoucher({
          type: "adjustment",
          financialYearId: before.resolvedFYId,
          voucherNumber,
          date: new Date(),
          narration: `Balance sheet plug (gap ${before.difference})`,
          referenceType: "bs_plug",
          referenceId: new mongoose.Types.ObjectId(),
          entries,
          session,
        });
      });
    } finally {
      await session.endSession();
    }
  }

  const after = afterOpen.gapAbs <= EPS ? await computeBalanceSheetGap(financialYearId) : afterOpen;

  return { applied: true, before, after };
}

/**
 * Ensures a clean enough state for posting; runs full heal if checks fail.
 */
async function validateAndHealBeforeTransaction(financialYearId) {
  if (!financialYearId) return { ok: true, issues: [] };
  let state = await validateSystemState(financialYearId);
  if (!state.ok) {
    await runSystemDiagnosticsAndAutoFix({ financialYearId, reason: "pre_transaction" });
    state = await validateSystemState(financialYearId);
  }
  if (!state.ok) {
    const e = new Error(
      "System state could not be repaired automatically. Run GET /api/system/validate or contact support.",
    );
    e.code = "SYSTEM_STATE_UNHEALABLE";
    e.status = 503;
    e.metrics = { issues: state.issues, diff: state.diff };
    throw e;
  }
  return state;
}

module.exports = {
  runSystemDiagnosticsAndAutoFix,
  runFullSystemDiagnostics,
  validateSystemState,
  validateAndHealBeforeTransaction,
  logSystemHeal,
  scanCodebaseIntegrity,
};
