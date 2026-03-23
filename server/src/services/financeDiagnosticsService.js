/**
 * Read-only financial integrity scans + optional safe normalization (trim strings only).
 * Does not delete business data or rewrite vouchers.
 */

const Voucher = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const BankAccount = require("../models/BankAccount");
const BankStatement = require("../models/BankStatement");
const BankTransaction = require("../models/BankTransaction");
const Expense = require("../models/Expense");
const {
  buildAccountMap,
  resolveFilter,
  round,
} = require("../controllers/reportController");

function mkIssue(module, type, severity, description, fixApplied = false, extra = {}) {
  return { module, type, severity, description, fixApplied, ...extra };
}

/**
 * Same classification as getBalanceSheet (reportController).
 */
function balanceSheetFromMap(map) {
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
    if (row.type === "equity") {
      retainedEarnings += -row.balance;
    }
    if (row.type === "revenue") revenue += row.credit - row.debit;
    if (row.type === "expense") expenses += row.debit - row.credit;
  }

  const currentYearProfit = round(revenue - expenses);
  const totalEquity = round(retainedEarnings + currentYearProfit);
  const totalAssets = round(cash + accountsReceivable + otherAssets);
  const totalLiabilities = round(gstPayable + otherLiabilities);
  const liabilitiesPlusEquity = round(totalLiabilities + totalEquity);
  const balanced = Math.abs(totalAssets - liabilitiesPlusEquity) < 0.02;

  return {
    totalAssets,
    totalLiabilities,
    totalEquity,
    liabilitiesPlusEquity,
    balanced,
  };
}

function accountingCashBankFromMap(map) {
  let cashBalance = 0;
  for (const row of map.values()) {
    if (row.type === "asset") {
      const name = (row.account || "").toLowerCase();
      if (name === "cash" || name.includes("bank")) {
        cashBalance += row.balance;
      }
    }
  }
  return cashBalance;
}

/**
 * @param {{ applySafeFixes?: boolean }} options
 */
async function runFinanceDiagnostics(options = {}) {
  const { applySafeFixes = false } = options;
  const issues = [];

  const [globalAgg] = await VoucherEntry.aggregate([
    { $group: { _id: null, d: { $sum: "$debit" }, c: { $sum: "$credit" } } },
  ]);
  const gDebit = globalAgg?.d || 0;
  const gCredit = globalAgg?.c || 0;
  const globalDiff = Math.abs(Number(gDebit) - Number(gCredit));
  if (globalDiff > 0.05) {
    issues.push(
      mkIssue(
        "Accounting Core",
        "global_debit_credit_mismatch",
        "critical",
        `All voucher lines: total debit (${round(gDebit)}) ≠ total credit (${round(gCredit)})`,
        false,
        { globalDebit: round(gDebit), globalCredit: round(gCredit) },
      ),
    );
  }

  const imbalances = await VoucherEntry.aggregate([
    {
      $group: {
        _id: "$voucherId",
        debit: { $sum: "$debit" },
        credit: { $sum: "$credit" },
      },
    },
    {
      $addFields: {
        diff: { $abs: { $subtract: ["$debit", "$credit"] } },
      },
    },
    { $match: { diff: { $gt: 0.02 } } },
    { $limit: 50 },
  ]);
  for (const row of imbalances) {
    if (!row._id) continue;
    issues.push(
      mkIssue(
        "Voucher System",
        "imbalanced_voucher",
        "critical",
        `Voucher ${String(row._id)} lines do not balance (|Dr−Cr|=${round(row.diff)})`,
        false,
        { voucherId: String(row._id) },
      ),
    );
  }

  const voucherCount = await Voucher.countDocuments({});
  const voucherEntryTotal = await VoucherEntry.countDocuments({});
  const allVoucherIds = await Voucher.distinct("_id");

  if (voucherCount === 0 && voucherEntryTotal > 0) {
    issues.push(
      mkIssue(
        "Voucher System",
        "ORPHAN_VOUCHERS",
        "critical",
        `${voucherEntryTotal} voucher line(s) exist but there are no vouchers in the database`,
        false,
      ),
    );
  } else if (voucherCount > 0 && allVoucherIds.length > 0) {
    const orphanCount = await VoucherEntry.countDocuments({
      voucherId: { $nin: allVoucherIds },
    });
    if (orphanCount > 0) {
      issues.push(
        mkIssue(
          "Voucher System",
          "ORPHAN_VOUCHERS",
          "critical",
          `${orphanCount} voucher line(s) reference deleted or missing vouchers`,
          false,
        ),
      );
    }
  }

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
  if (nonApprovedLinked.length > 0) {
    issues.push(
      mkIssue(
        "Voucher System",
        "NON_APPROVED_EXPENSE_VOUCHERS",
        "critical",
        `${nonApprovedLinked.length} voucher(s) linked to expenses that are not approved`,
        false,
        { expenseIds: nonApprovedLinked.map((e) => String(e._id)) },
      ),
    );
  }

  const missingAcc = await VoucherEntry.countDocuments({
    $or: [{ accountId: null }, { accountId: { $exists: false } }],
  });
  if (missingAcc > 0) {
    issues.push(
      mkIssue(
        "Accounting Core",
        "missing_account_id",
        "warning",
        `${missingAcc} voucher line(s) without accountId (run migrateVoucherEntries)`,
        false,
      ),
    );
  }

  const noFy = await Voucher.countDocuments({
    $or: [{ financialYearId: null }, { financialYearId: { $exists: false } }],
  });
  if (noFy > 0) {
    issues.push(
      mkIssue(
        "Financial Year",
        "missing_financial_year_id",
        "warning",
        `${noFy} voucher(s) without financialYearId`,
        false,
      ),
    );
  }

  const negBanks = await BankAccount.find({ balance: { $lt: 0 } }).select("name balance").lean();
  for (const b of negBanks) {
    issues.push(
      mkIssue(
        "Financial Data Integrity",
        "NEGATIVE_CASH",
        "critical",
        `Operational account "${b.name}" has negative balance ${round(b.balance)}`,
        false,
        { bankAccountId: String(b._id) },
      ),
    );
  }

  const { voucherIds, financialYearId } = await resolveFilter({});
  const map = await buildAccountMap(voucherIds, financialYearId);
  const bs = balanceSheetFromMap(map);

  if (!bs.balanced) {
    issues.push(
      mkIssue(
        "Reports",
        "balance_sheet_equation",
        "critical",
        `Balance sheet (voucher-based, active FY filter): Assets (${bs.totalAssets}) ≠ Liabilities+Equity (${bs.liabilitiesPlusEquity})`,
        false,
        {
          totalAssets: bs.totalAssets,
          liabilitiesPlusEquity: bs.liabilitiesPlusEquity,
        },
      ),
    );
  }

  let tbDebit = 0;
  let tbCredit = 0;
  for (const row of map.values()) {
    tbDebit += Number(row.debit) || 0;
    tbCredit += Number(row.credit) || 0;
  }
  if (Math.abs(tbDebit - tbCredit) > 0.05) {
    issues.push(
      mkIssue(
        "Reports",
        "trial_balance_imbalance",
        "critical",
        `Trial balance (map): total debit ${round(tbDebit)} ≠ total credit ${round(tbCredit)}`,
        false,
      ),
    );
  }

  const opAgg = await BankAccount.aggregate([
    { $group: { _id: null, total: { $sum: "$balance" } } },
  ]);
  const operationalCashBank = opAgg[0] ? Number(opAgg[0].total) || 0 : 0;
  const accountingCashBank = accountingCashBankFromMap(map);
  if (operationalCashBank < 0 || accountingCashBank < 0) {
    issues.push(
      mkIssue(
        "Financial Data Integrity",
        "NEGATIVE_CASH_GL",
        "critical",
        `Negative liquidity signal: operational bank sum=${round(operationalCashBank)}, accounting cash+bank (chart)=${round(accountingCashBank)}`,
        false,
        { operationalCashBank: round(operationalCashBank), accountingCashBank: round(accountingCashBank) },
      ),
    );
  }

  const unreconciledBankTx = await BankTransaction.countDocuments({ isReconciled: { $ne: true } });
  if (unreconciledBankTx > 0) {
    issues.push(
      mkIssue(
        "Bank Reconciliation",
        "UNRECONCILED_BANK_TRANSACTIONS",
        "warning",
        `${unreconciledBankTx} bank transaction(s) not yet reconciled`,
        false,
        { count: unreconciledBankTx },
      ),
    );
  }

  const bankAccs = await BankAccount.find({}).select("name balance").lean();
  const opsCashRow = bankAccs.find((b) => b.name === "Cash");
  const opsBankRows = bankAccs.filter((b) => b.name !== "Cash");
  const opsCashBal = opsCashRow ? Number(opsCashRow.balance) || 0 : 0;
  const opsBankBal = opsBankRows.reduce((s, b) => s + (Number(b.balance) || 0), 0);
  let glCash = 0;
  let glBank = 0;
  for (const row of map.values()) {
    if (row.account === "Cash") glCash = Number(row.balance) || 0;
    else if (row.account === "Bank") glBank = Number(row.balance) || 0;
  }
  const glTotal = glCash + glBank;
  const opsTotal = opsCashBal + opsBankBal;
  const bankGlDiff = Math.abs(glTotal - opsTotal);
  if (bankGlDiff > 1) {
    issues.push(
      mkIssue(
        "Financial Data Integrity",
        "BANK_GL_MISMATCH",
        "critical",
        `Operational cash/bank (${round(opsTotal)}) ≠ GL Cash+Bank (${round(glTotal)}). Difference ${round(bankGlDiff)}.`,
        false,
        {
          operationalTotal: round(opsTotal),
          glCash: round(glCash),
          glBank: round(glBank),
          difference: round(bankGlDiff),
        },
      ),
    );
  }

  const veCount = await VoucherEntry.countDocuments({});

  const dupPay = await BankStatement.aggregate([
    {
      $match: {
        isMatched: true,
        matchedReferenceType: "payment",
        matchedReferenceId: { $ne: null },
      },
    },
    { $group: { _id: "$matchedReferenceId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  if (dupPay.length > 0) {
    issues.push(
      mkIssue(
        "Bank Reconciliation",
        "duplicate_payment_match",
        "warning",
        `${dupPay.length} payment document(s) matched to more than one bank statement line`,
        false,
      ),
    );
  }

  const dupExp = await BankStatement.aggregate([
    {
      $match: {
        isMatched: true,
        matchedReferenceType: "expense",
        matchedReferenceId: { $ne: null },
      },
    },
    { $group: { _id: "$matchedReferenceId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  if (dupExp.length > 0) {
    issues.push(
      mkIssue(
        "Bank Reconciliation",
        "duplicate_expense_match",
        "warning",
        `${dupExp.length} expense document(s) matched to more than one bank statement line`,
        false,
      ),
    );
  }

  let trimWrites = 0;
  if (applySafeFixes) {
    const suspicious = await Expense.find({
      $or: [{ category: /^\s+/ }, { category: /\s+$/ }],
    })
      .select("_id category")
      .limit(5000)
      .lean();

    for (const doc of suspicious) {
      const trimmed = String(doc.category ?? "").trim();
      if (trimmed && trimmed !== doc.category) {
        await Expense.updateOne({ _id: doc._id }, { $set: { category: trimmed } });
        trimWrites += 1;
      }
    }
    if (trimWrites > 0) {
      issues.push(
        mkIssue(
          "Invoice / Expense Flow",
          "expense_category_trim",
          "low",
          `Trimmed leading/trailing whitespace on ${trimWrites} expense category field(s)`,
          true,
        ),
      );
    }
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const low = issues.filter((i) => i.severity === "low").length;
  const warning = issues.filter((i) => i.severity === "warning").length;
  const fixedCount = issues.filter((i) => i.fixApplied).length;

  return {
    generatedAt: new Date().toISOString(),
    applySafeFixes,
    summary: {
      totalIssues: issues.length,
      critical,
      warning,
      medium,
      low,
      fixesAppliedCount: fixedCount,
      safeNormalizationWrites: applySafeFixes ? trimWrites : 0,
    },
    metrics: {
      globalDebit: round(gDebit),
      globalCredit: round(gCredit),
      globalDebitCreditDiff: round(globalDiff),
      balanceSheetBalanced: bs.balanced,
      totalAssets: bs.totalAssets,
      liabilitiesPlusEquity: bs.liabilitiesPlusEquity,
      operationalCashBank: round(operationalCashBank),
      accountingCashBank: round(accountingCashBank),
      voucherEntryCount: veCount,
    },
    issues,
  };
}

module.exports = { runFinanceDiagnostics };
