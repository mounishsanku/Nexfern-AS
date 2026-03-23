const VoucherEntry = require("../models/VoucherEntry");
const Voucher = require("../models/Voucher");
const BankTransaction = require("../models/BankTransaction");
const Expense = require("../models/Expense");
const Invoice = require("../models/Invoice");
const FinancialYear = require("../models/FinancialYear");
const BankAccount = require("../models/BankAccount");
const { buildAccountMap, resolveFilter, round } = require("../controllers/reportController");

const EPS = 0.02;
/** Operational wallets vs GL Cash+Bank — rupee tolerance (aligned with bankGlConsistencyService). */
const BANK_GL_EPS = 1;

async function runSystemValidation() {
  const errors = [];
  const warnings = [];
  const metrics = {};

  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  metrics.activeFinancialYearId = fy ? String(fy._id) : null;
  metrics.activeFinancialYearName = fy?.name ?? null;

  const voucherIdsForFy = fy ? await Voucher.distinct("_id", { financialYearId: fy._id }) : [];

  metrics.voucherCountActiveFy = voucherIdsForFy.length;

  // --- Vouchers missing type or number (any FY) ---
  const malformedVoucherCount = await Voucher.countDocuments({
    $or: [{ type: { $in: [null, ""] } }, { voucherNumber: { $in: [null, ""] } }],
  });
  metrics.malformedVoucherCount = malformedVoucherCount;
  if (malformedVoucherCount > 0) {
    errors.push({
      code: "INVALID_VOUCHERS",
      severity: "critical",
      message: `${malformedVoucherCount} voucher(s) missing type or voucherNumber.`,
    });
  }

  // --- Per-voucher: at least 2 lines and balanced (active FY) ---
  if (voucherIdsForFy.length) {
    const lineAgg = await VoucherEntry.aggregate([
      { $match: { voucherId: { $in: voucherIdsForFy } } },
      {
        $group: {
          _id: "$voucherId",
          lines: { $sum: 1 },
          td: { $sum: "$debit" },
          tc: { $sum: "$credit" },
        },
      },
    ]);
    const byV = new Map(lineAgg.map((r) => [String(r._id), r]));
    let badPerVoucher = 0;
    for (const vid of voucherIdsForFy) {
      const row = byV.get(String(vid));
      if (!row || row.lines < 2 || Math.abs(Number(row.td) - Number(row.tc)) > EPS) {
        badPerVoucher += 1;
      }
    }
    metrics.vouchersWithInvalidLines = badPerVoucher;
    if (badPerVoucher > 0) {
      errors.push({
        code: "VOUCHER_LINE_IMBALANCE",
        severity: "critical",
        message: `${badPerVoucher} voucher(s) in the active FY have fewer than 2 lines or unequal debits and credits.`,
      });
    }
  }

  // --- Voucher entry debit == credit (active FY) ---
  let entryDebit = 0;
  let entryCredit = 0;
  if (voucherIdsForFy.length) {
    const agg = await VoucherEntry.aggregate([
      { $match: { voucherId: { $in: voucherIdsForFy } } },
      { $group: { _id: null, td: { $sum: "$debit" }, tc: { $sum: "$credit" } } },
    ]);
    entryDebit = agg[0] ? Number(agg[0].td) || 0 : 0;
    entryCredit = agg[0] ? Number(agg[0].tc) || 0 : 0;
  }
  metrics.voucherEntryTotalDebit = round(entryDebit);
  metrics.voucherEntryTotalCredit = round(entryCredit);
  metrics.voucherEntryBalanced = Math.abs(entryDebit - entryCredit) < EPS;
  if (!metrics.voucherEntryBalanced) {
    errors.push({
      code: "VOUCHER_ENTRIES_UNBALANCED",
      severity: "critical",
      message: `Voucher entries for the active FY: total debit (${round(entryDebit)}) ≠ total credit (${round(entryCredit)}).`,
    });
  }

  // --- Orphan voucher entries ---
  const orphanAgg = await VoucherEntry.aggregate([
    { $lookup: { from: "vouchers", localField: "voucherId", foreignField: "_id", as: "v" } },
    { $match: { v: { $size: 0 } } },
    { $count: "c" },
  ]);
  const orphanCount = orphanAgg[0]?.c ?? 0;
  metrics.orphanVoucherEntryCount = orphanCount;
  if (orphanCount > 0) {
    errors.push({
      code: "ORPHAN_VOUCHER_ENTRIES",
      severity: "critical",
      message: `${orphanCount} voucher line(s) reference a missing voucher.`,
    });
  }

  // --- Vouchers must not reference non-approved expenses (only approved posts vouchers) ---
  const expenseVouchers = await Voucher.find({
    referenceType: "expense",
    referenceId: { $exists: true, $ne: null },
  })
    .select("referenceId")
    .lean();
  const linkedExpenseIds = [...new Set(expenseVouchers.map((v) => String(v.referenceId)))];
  let nonApprovedLinked = [];
  if (linkedExpenseIds.length) {
    nonApprovedLinked = await Expense.find({
      _id: { $in: linkedExpenseIds },
      status: { $ne: "approved" },
    })
      .select("_id status")
      .lean();
  }
  metrics.voucherLinkedNonApprovedExpenseCount = nonApprovedLinked.length;
  if (nonApprovedLinked.length) {
    for (const row of nonApprovedLinked) {
      // eslint-disable-next-line no-console
      console.warn(
        "[FinanceOS][validate] Voucher exists for non-approved expense — financials may be inconsistent:",
        String(row._id),
        "status=",
        row.status,
      );
    }
    errors.push({
      code: "NON_APPROVED_EXPENSE_VOUCHERS",
      severity: "critical",
      message: `${nonApprovedLinked.length} expense voucher(s) linked to documents that are not approved. Pending/rejected expenses must not have vouchers.`,
    });
  }

  // --- Duplicate invoice numbers ---
  const dupInv = await Invoice.aggregate([
    { $match: { invoiceNumber: { $nin: [null, ""] } } },
    { $group: { _id: "$invoiceNumber", c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
  ]);
  metrics.duplicateInvoiceNumberGroups = dupInv.length;
  if (dupInv.length) {
    errors.push({
      code: "DUPLICATE_INVOICE_NUMBERS",
      message: `Duplicate invoiceNumber values: ${dupInv.map((d) => d._id).join(", ")}`,
    });
  }

  // --- Balance sheet equation (active FY, same basis as reports) ---
  try {
    const { voucherIds, financialYearId } = await resolveFilter({});
    const map = await buildAccountMap(voucherIds, financialYearId);

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
    const gap = Math.abs(totalAssets - liabilitiesPlusEquity);

    metrics.balanceSheetTotalAssets = totalAssets;
    metrics.balanceSheetLiabilitiesPlusEquity = liabilitiesPlusEquity;
    metrics.balanceSheetGap = round(gap);
    metrics.balanceSheetBalanced = gap < EPS;

    if (!metrics.balanceSheetBalanced) {
      errors.push({
        code: "BALANCE_SHEET_IMBALANCE",
        severity: "critical",
        message: `Assets (${totalAssets}) ≠ Liabilities + Equity (${liabilitiesPlusEquity}); gap ${round(gap)}.`,
      });
    }
  } catch (e) {
    warnings.push({
      code: "BALANCE_SHEET_CHECK_SKIPPED",
      message: `Balance sheet validation skipped: ${e?.message || e}`,
    });
  }

  // --- Trial balance movement columns (informational) ---
  try {
    const { voucherIds, financialYearId } = await resolveFilter({});
    const map = await buildAccountMap(voucherIds, financialYearId);
    let td = 0;
    let tc = 0;
    for (const row of map.values()) {
      td += Number(row.debit) || 0;
      tc += Number(row.credit) || 0;
    }
    metrics.trialBalanceMovementDebit = round(td);
    metrics.trialBalanceMovementCredit = round(tc);
    metrics.trialBalanceMovementBalanced = Math.abs(td - tc) < EPS;
    if (!metrics.trialBalanceMovementBalanced) {
      warnings.push({
        code: "TB_MOVEMENT_COLUMNS_MISMATCH",
        message: `Sum of period debits (${round(td)}) ≠ sum of period credits (${round(tc)}). Check voucher integrity.`,
      });
    }
  } catch (e) {
    warnings.push({
      code: "TB_CHECK_SKIPPED",
      message: `Trial balance check skipped: ${e?.message || e}`,
    });
  }

  // --- Negative cash (operational bank accounts) → ERROR ---
  const negBank = await BankAccount.find({ balance: { $lt: -EPS } }).select("name balance").lean();
  metrics.negativeBankAccountCount = negBank.length;
  if (negBank.length) {
    errors.push({
      code: "NEGATIVE_CASH",
      severity: "critical",
      message: `Negative balance on: ${negBank.map((b) => `${b.name} (${round(b.balance)})`).join("; ")}`,
    });
  }

  // --- Deferred revenue < 0 → ERROR ---
  try {
    const { voucherIds: vIds, financialYearId: fyId } = await resolveFilter({});
    const accMap = await buildAccountMap(vIds, fyId);
    const defRow = [...accMap.values()].find((r) => r.account === "Deferred Revenue");
    const defBal = defRow ? (Number(defRow.credit) || 0) - (Number(defRow.debit) || 0) : 0;
    metrics.deferredRevenueBalance = round(defBal);
    if (defBal < -EPS) {
      errors.push({
        code: "DEFERRED_REVENUE_NEGATIVE",
        severity: "critical",
        message: `Deferred Revenue balance is negative (${round(defBal)}) — invalid state.`,
      });
    }
  } catch (e) {
    warnings.push({
      code: "DEFERRED_REVENUE_CHECK_SKIPPED",
      message: `Deferred revenue check skipped: ${e?.message || e}`,
    });
  }

  // --- Orphan vouchers (vouchers referencing deleted entities) → ERROR ---
  const vouchersWithRef = await Voucher.find({
    referenceType: { $in: ["expense", "invoice", "payment", "payroll"] },
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id referenceType referenceId")
    .lean();
  const Payment = require("../models/Payment");
  const Employee = require("../models/Employee");
  const Payslip = require("../models/Payslip");

  let orphanVoucherCount = 0;
  for (const v of vouchersWithRef) {
    const rid = v.referenceId;
    let exists = false;
    if (v.referenceType === "expense") {
      exists = !!(await Expense.findById(rid).select("_id").lean());
    } else if (v.referenceType === "invoice") {
      exists = !!(await Invoice.findById(rid).select("_id").lean());
    } else if (v.referenceType === "payment") {
      exists = !!(await Payment.findById(rid).select("_id").lean());
    } else if (v.referenceType === "payroll") {
      exists = !!(await Payslip.findById(rid).select("_id").lean());
      if (!exists) {
        exists = !!(await Employee.findById(rid).select("_id").lean());
      }
    }
    if (!exists) orphanVoucherCount++;
  }
  metrics.orphanVoucherCount = orphanVoucherCount;
  if (orphanVoucherCount > 0) {
    errors.push({
      code: "ORPHAN_VOUCHERS",
      severity: "critical",
      message: `${orphanVoucherCount} voucher(s) reference deleted or missing documents.`,
    });
  }

  // --- Unreconciled bank transactions → WARNING ---
  const unreconciledCount = await BankTransaction.countDocuments({ isReconciled: { $ne: true } });
  metrics.unreconciledBankTransactionCount = unreconciledCount;
  if (unreconciledCount > 0) {
    warnings.push({
      code: "UNRECONCILED_BANK_TRANSACTIONS",
      message: `${unreconciledCount} bank transaction(s) not yet reconciled.`,
    });
  }

  // --- Bank vs GL mismatch (operational wallets vs chart Cash+Bank) → CRITICAL ERROR ---
  try {
    const bankAccs = await BankAccount.find({}).select("name balance").lean();
    const { voucherIds: vIds2, financialYearId: fyId2 } = await resolveFilter({});
    const accMap2 = await buildAccountMap(vIds2, fyId2);
    let glCash = 0;
    let glBank = 0;
    for (const row of accMap2.values()) {
      if (row.account === "Cash") glCash = Number(row.balance) || 0;
      else if (row.account === "Bank") glBank = Number(row.balance) || 0;
    }
    const opsCashRow = bankAccs.find((b) => b.name === "Cash");
    const opsBankRows = bankAccs.filter((b) => b.name !== "Cash");
    const opsCashBal = opsCashRow ? Number(opsCashRow.balance) || 0 : 0;
    const opsBankBal = opsBankRows.reduce((s, b) => s + (Number(b.balance) || 0), 0);
    const glTotal = glCash + glBank;
    const opsTotal = opsCashBal + opsBankBal;
    const bankGlDiff = Math.abs(glTotal - opsTotal);
    metrics.bankGlOperationalTotal = round(opsTotal);
    metrics.bankGlChartTotal = round(glTotal);
    metrics.bankGlDifference = round(bankGlDiff);
    metrics.bankGlCashChart = round(glCash);
    metrics.bankGlBankChart = round(glBank);
    if (bankGlDiff > BANK_GL_EPS) {
      errors.push({
        code: "BANK_GL_MISMATCH",
        severity: "critical",
        message: `Operational cash/bank (${round(opsTotal)}) ≠ GL Cash+Bank (${round(glTotal)}). Difference ${round(bankGlDiff)}.`,
      });
    }
  } catch (e) {
    warnings.push({
      code: "BANK_GL_CHECK_SKIPPED",
      message: `Bank vs GL check skipped: ${e?.message || e}`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    errors,
    warnings,
    metrics,
  };
}

module.exports = { runSystemValidation };
