/**
 * Advanced financial scenario tests — uses server voucher engine + reportController.
 * Run from repo root: node scripts/financialScenarioTests.js
 * Requires MONGODB_URI in server/.env
 *
 * Prints JSON array of { scenario, result, issues } to stdout.
 */

const path = require("path");
const fs = require("fs");

const serverRoot = path.join(__dirname, "..", "server");
const envPath = path.join(serverRoot, ".env");
require(path.join(serverRoot, "node_modules", "dotenv")).config(
  fs.existsSync(envPath) ? { path: envPath } : {},
);

const mongoose = require(path.join(serverRoot, "node_modules", "mongoose"));
const { connectDb } = require(path.join(serverRoot, "src", "config", "db"));

const VoucherEntry = require(path.join(serverRoot, "src", "models", "VoucherEntry"));
const Voucher = require(path.join(serverRoot, "src", "models", "Voucher"));
const Invoice = require(path.join(serverRoot, "src", "models", "Invoice"));
const Payment = require(path.join(serverRoot, "src", "models", "Payment"));
const Expense = require(path.join(serverRoot, "src", "models", "Expense"));
const BankTransaction = require(path.join(serverRoot, "src", "models", "BankTransaction"));
const OpeningBalance = require(path.join(serverRoot, "src", "models", "OpeningBalance"));
const RevenueSchedule = require(path.join(serverRoot, "src", "models", "RevenueSchedule"));
const BankAccount = require(path.join(serverRoot, "src", "models", "BankAccount"));
const Customer = require(path.join(serverRoot, "src", "models", "Customer"));
const FinancialYear = require(path.join(serverRoot, "src", "models", "FinancialYear"));
const Employee = require(path.join(serverRoot, "src", "models", "Employee"));
const Payslip = require(path.join(serverRoot, "src", "models", "Payslip"));

const {
  createVoucher,
  createVoucherForInvoice,
  createVoucherForPayment,
  createVoucherForExpense,
  createVoucherForRevenueRecognition,
} = require(path.join(serverRoot, "src", "services", "voucherService"));
const { recordBankTransaction } = require(path.join(serverRoot, "src", "services", "bankService"));
const { createInvoiceFromData } = require(path.join(serverRoot, "src", "controllers", "invoiceController"));
const {
  resolveFilter,
  buildAccountMap,
  round,
} = require(path.join(serverRoot, "src", "controllers", "reportController"));

const EPS = 0.02;

/** Operational + GL Cash/Bank stay aligned (required for invariant-safe debits). */
async function seedAlignedCash(fyId, amount) {
  const a = Number(amount) || 0;
  if (a <= 0) return;
  await recordBankTransaction({
    bankAccountId: null,
    type: "credit",
    amount: a,
    referenceType: "manual",
    referenceId: new mongoose.Types.ObjectId(),
  });
  await createVoucher({
    type: "journal",
    narration: "Scenario test — seed cash (operational + GL)",
    financialYearId: fyId,
    entries: [
      { account: "Cash", debit: a, credit: 0 },
      { account: "Owner's Capital", debit: 0, credit: a },
    ],
  });
}

async function wipeTransactional() {
  await RevenueSchedule.deleteMany({});
  await Payslip.deleteMany({});
  await Payment.deleteMany({});
  await Expense.deleteMany({});
  await Invoice.deleteMany({});
  await VoucherEntry.deleteMany({});
  await Voucher.deleteMany({});
  await BankTransaction.deleteMany({});
  await OpeningBalance.deleteMany({});
  await Employee.deleteMany({});
  await BankAccount.updateMany({}, { $set: { balance: 0 } });
}

function rowByName(map, name) {
  for (const r of map.values()) {
    if (r.account === name) return r;
  }
  return null;
}

async function loadMap(fyId) {
  const { voucherIds, financialYearId } = await resolveFilter({
    financialYearId: String(fyId),
  });
  const map = await buildAccountMap(voucherIds, financialYearId);
  return { map, financialYearId };
}

function trialBalanceOk(map) {
  let td = 0;
  let tc = 0;
  for (const r of map.values()) {
    td += r.debit;
    tc += r.credit;
  }
  return Math.abs(td - tc) < EPS;
}

function pnlFromMap(map) {
  let revenue = 0;
  let expenses = 0;
  for (const r of map.values()) {
    if (r.type === "revenue") revenue += r.credit - r.debit;
    if (r.type === "expense") expenses += r.debit - r.credit;
  }
  return { revenue: round(revenue), expenses: round(expenses), profit: round(revenue - expenses) };
}

function balanceSheetEquation(map) {
  let cash = 0;
  let ar = 0;
  let oa = 0;
  let gst = 0;
  let ol = 0;
  let re = 0;
  let rev = 0;
  let exp = 0;
  for (const row of map.values()) {
    if (row.type === "asset") {
      if (row.account === "Cash") cash = row.balance;
      else if (row.account === "Accounts Receivable") ar = row.balance;
      else oa += row.balance;
    }
    if (row.type === "liability") {
      if (row.account === "GST Payable") gst = -row.balance;
      else ol += -row.balance;
    }
    if (row.type === "equity") re += -row.balance;
    if (row.type === "revenue") rev += row.credit - row.debit;
    if (row.type === "expense") exp += row.debit - row.credit;
  }
  const totalAssets = round(cash + ar + oa);
  const totalLiab = round(gst + ol);
  const cy = round(rev - exp);
  const totalEq = round(re + cy);
  const lpe = round(totalLiab + totalEq);
  return { balanced: Math.abs(totalAssets - lpe) < EPS, totalAssets, liabilitiesPlusEquity: lpe };
}

async function duplicateVoucherSanity() {
  const groups = await VoucherEntry.aggregate([
    {
      $group: {
        _id: { voucherId: "$voucherId", accountId: "$accountId" },
        n: { $sum: 1 },
      },
    },
    { $match: { n: { $gt: 1 } } },
  ]);
  return groups.length;
}

async function getActiveFy() {
  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  if (!fy) throw new Error("No active financial year");
  return fy._id;
}

async function ensureCustomer() {
  let c = await Customer.findOne().lean();
  if (!c) {
    c = await Customer.create({ name: "Test Customer", email: "test-scenario@example.com" });
  }
  return c;
}

function pushIssue(issues, cond, msg) {
  if (!cond) issues.push(msg);
  return cond;
}

async function scenario1(fyId, customerId) {
  const issues = [];
  const inv = await Invoice.create({
    customer: customerId,
    amount: 10000,
    financialYearId: fyId,
    gstType: "CGST_SGST",
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalAmount: 10000,
    paidAmount: 0,
    status: "unpaid",
    isDeferred: false,
    revenueType: "project",
    department: "tech",
    createdAt: new Date(),
  });
  await createVoucherForInvoice({ invoice: inv, financialYearId: fyId });

  const pay = await Payment.create({
    invoiceId: inv._id,
    amount: 4000,
    method: "cash",
    financialYearId: fyId,
    date: new Date(),
  });
  await createVoucherForPayment({ payment: pay, financialYearId: fyId });
  await recordBankTransaction({
    bankAccountId: null,
    type: "credit",
    amount: 4000,
    referenceType: "payment",
    referenceId: pay._id,
  });
  inv.paidAmount = 4000;
  inv.status = "partial";
  await inv.save();

  const { map } = await loadMap(fyId);
  const ar = rowByName(map, "Accounts Receivable");
  const cash = rowByName(map, "Cash");
  const pnl = pnlFromMap(map);

  pushIssue(issues, Math.abs((ar?.balance ?? 0) - 6000) < EPS, `AR expected 6000, got ${ar?.balance}`);
  pushIssue(issues, Math.abs((cash?.balance ?? 0) - 4000) < EPS, `Cash expected 4000, got ${cash?.balance}`);
  pushIssue(issues, Math.abs(pnl.revenue - 10000) < EPS, `Revenue expected 10000, got ${pnl.revenue}`);
  pushIssue(issues, Math.abs(pnl.profit - 10000) < EPS, `P&L profit expected 10000, got ${pnl.profit}`);
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");
  pushIssue(issues, balanceSheetEquation(map).balanced, "Balance sheet equation failed");

  const dup = await duplicateVoucherSanity();
  pushIssue(issues, dup === 0, `Unexpected duplicate voucher line groups: ${dup}`);

  return { scenario: "1_partial_payment", result: issues.length === 0 ? "pass" : "fail", issues };
}

async function scenario2(fyId) {
  const issues = [];
  const seed = 10_000;
  await seedAlignedCash(fyId, seed);

  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);

  const ex = await Expense.create({
    title: "Before revenue",
    amount: 2000,
    category: "utilities",
    department: "tech",
    date: d,
    financialYearId: fyId,
    tdsApplicable: false,
    status: "approved",
    approvedAt: new Date(),
    approvedBy: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
  });
  await createVoucherForExpense({ expense: ex, financialYearId: fyId });
  await recordBankTransaction({
    bankAccountId: null,
    type: "debit",
    amount: 2000,
    referenceType: "expense",
    referenceId: ex._id,
  });

  const cust = await ensureCustomer();
  const inv = await Invoice.create({
    customer: cust._id,
    amount: 5000,
    financialYearId: fyId,
    gstType: "CGST_SGST",
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalAmount: 5000,
    paidAmount: 0,
    status: "unpaid",
    isDeferred: false,
    revenueType: "project",
    department: "tech",
    createdAt: new Date(),
  });
  await createVoucherForInvoice({ invoice: inv, financialYearId: fyId });

  const { map } = await loadMap(fyId);
  const cash = rowByName(map, "Cash");
  const pnl = pnlFromMap(map);

  pushIssue(
    issues,
    Math.abs((cash?.balance ?? 0) - (seed - 2000)) < EPS,
    `Cash expected ${seed - 2000} after seed and expense; got ${cash?.balance}`,
  );
  pushIssue(issues, Math.abs(pnl.profit - 3000) < EPS, `Profit expected 3000, got ${pnl.profit}`);
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");
  pushIssue(issues, balanceSheetEquation(map).balanced, "Balance sheet equation failed");

  return { scenario: "2_expense_before_revenue", result: issues.length === 0 ? "pass" : "fail", issues };
}

async function scenario3(fyId) {
  const issues = [];
  await seedAlignedCash(fyId, 250_000);
  const notes = [
    "Rent / salary / marketing categories map to Rent Expense, Salary Expense, and Marketing Expense GL accounts.",
  ];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);

  const specs = [
    { title: "Rent", amount: 5000, category: "rent" },
    { title: "Salary", amount: 10000, category: "salary" },
    { title: "Marketing", amount: 2000, category: "marketing" },
  ];

  for (const s of specs) {
    const ex = await Expense.create({
      title: s.title,
      amount: s.amount,
      category: s.category,
      department: "tech",
      date: d,
      financialYearId: fyId,
      tdsApplicable: false,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
    });
    await createVoucherForExpense({ expense: ex, financialYearId: fyId });
    await recordBankTransaction({
      bankAccountId: null,
      type: "debit",
      amount: s.amount,
      referenceType: "expense",
      referenceId: ex._id,
    });
  }

  const cats = await Expense.find({ financialYearId: fyId }).distinct("category");
  const { map } = await loadMap(fyId);
  const pnl = pnlFromMap(map);
  const rent = rowByName(map, "Rent Expense");
  const sal = rowByName(map, "Salary Expense");
  const mkt = rowByName(map, "Marketing Expense");

  pushIssue(issues, Math.abs(pnl.expenses - 17000) < EPS, `Total expenses expected 17000, got ${pnl.expenses}`);
  pushIssue(issues, specs.every((s) => cats.includes(s.category)), `Expense categories missing in DB: ${cats.join(",")}`);
  pushIssue(issues, Math.abs((rent?.debit ?? 0) - 5000) < EPS, `Rent Expense debit expected 5000, got ${rent?.debit}`);
  pushIssue(issues, Math.abs((sal?.debit ?? 0) - 10000) < EPS, `Salary Expense debit expected 10000, got ${sal?.debit}`);
  pushIssue(issues, Math.abs((mkt?.debit ?? 0) - 2000) < EPS, `Marketing Expense debit expected 2000, got ${mkt?.debit}`);
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");

  return {
    scenario: "3_multiple_expense_types",
    result: issues.length === 0 ? "pass" : "fail",
    issues,
    notes,
  };
}

async function scenario4(fyId) {
  const issues = [];
  await seedAlignedCash(fyId, 250_000);
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);

  const ex = await Expense.create({
    title: "TDS vendor",
    amount: 10000,
    category: "utilities",
    department: "tech",
    date: d,
    financialYearId: fyId,
    tdsApplicable: true,
    tdsRate: 10,
    tdsAmount: 1000,
    status: "approved",
    approvedAt: new Date(),
    approvedBy: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
  });
  await createVoucherForExpense({ expense: ex, financialYearId: fyId });
  await recordBankTransaction({
    bankAccountId: null,
    type: "debit",
    amount: 9000,
    referenceType: "expense",
    referenceId: ex._id,
  });

  const { map } = await loadMap(fyId);
  const cash = rowByName(map, "Cash");
  const tds = rowByName(map, "TDS Payable");
  const ge = rowByName(map, "General Expense");

  pushIssue(issues, Math.abs((ge?.debit ?? 0) - 10000) < EPS, `Expense debit expected 10000, got ${ge?.debit}`);
  const seedAmt = 250000;
  pushIssue(
    issues,
    Math.abs((cash?.balance ?? 0) - (seedAmt - 9000)) < EPS,
    `Cash expected ${seedAmt - 9000} after seed and net pay; got ${cash?.balance}`,
  );
  const tdsBal = -(tds?.balance ?? 0);
  pushIssue(issues, Math.abs(tdsBal - 1000) < EPS, `TDS Payable expected 1000, got ${tdsBal}`);
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");

  return { scenario: "4_tds_expense", result: issues.length === 0 ? "pass" : "fail", issues };
}

async function scenario5(fyId) {
  const issues = [];
  const monthKey = "2030-06";

  await seedAlignedCash(fyId, 500_000);

  await Employee.create({
    name: "Scenario Employee",
    email: `scenario-payroll-${Date.now()}@example.com`,
    basicSalary: 50000,
    allowances: 0,
    deductions: 0,
    tds: 5000,
    pfAmount: 2000,
    esiAmount: 1000,
    isActive: true,
    joiningDate: new Date(),
  });

  const { runPayroll } = require(path.join(serverRoot, "src", "controllers", "payrollController"));
  const req = {
    user: { sub: "scenario-test" },
    activeYear: { _id: fyId },
    body: { month: monthKey, paymentAccount: "cash", department: "tech" },
  };
  let captured;
  const res = {
    status() {
      return this;
    },
    json(data) {
      captured = data;
      return this;
    },
  };
  await runPayroll(req, res);
  pushIssue(issues, (captured?.processedCount ?? 0) >= 1, `Payroll did not process: ${JSON.stringify(captured)}`);
  if (captured?.errors?.length) issues.push(`Payroll errors: ${JSON.stringify(captured.errors)}`);

  const { map } = await loadMap(fyId);
  const sal = rowByName(map, "Salary Expense");
  const cash = rowByName(map, "Cash");
  const tds = rowByName(map, "TDS Payable");
  const pdp = rowByName(map, "Payroll Deductions Payable");

  pushIssue(issues, Math.abs((sal?.debit ?? 0) - 50000) < EPS, `Salary Expense debit expected 50000, got ${sal?.debit}`);
  const expectedCashAfterPayroll = 500000 - 42000;
  pushIssue(
    issues,
    Math.abs((cash?.balance ?? 0) - expectedCashAfterPayroll) < EPS,
    `Cash expected ~${expectedCashAfterPayroll} after net pay; got ${cash?.balance}`,
  );
  const tdsLiability = -(tds?.balance ?? 0);
  pushIssue(issues, Math.abs(tdsLiability - 5000) < EPS, `TDS Payable expected ~5000, got ${tdsLiability}`);
  const pd = -(pdp?.balance ?? 0);
  pushIssue(issues, Math.abs(pd - 3000) < EPS, `Payroll deductions payable expected ~3000 (PF+ESI), got ${pd}`);
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");

  return { scenario: "5_payroll", result: issues.length === 0 ? "pass" : "fail", issues };
}

async function scenario6(fyId, customerId) {
  const issues = [];

  const inv = await createInvoiceFromData({
    userId: new mongoose.Types.ObjectId(),
    customerId: String(customerId),
    amount: 12000,
    gstRate: 0,
    gstType: "CGST_SGST",
    isDeferred: true,
    deferredMonths: 3,
    revenueType: "project",
    department: "tech",
    financialYearId: fyId,
  });

  const past = new Date();
  past.setDate(past.getDate() - 1);
  await RevenueSchedule.updateMany({ invoiceId: inv._id }, { $set: { date: past } });

  const due = await RevenueSchedule.find({ invoiceId: inv._id, isRecognized: false }).lean();
  const totalAmt = due.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const scheduleIds = due.map((s) => s._id);
  pushIssue(issues, scheduleIds.length === 3, `Expected 3 revenue schedules, got ${scheduleIds.length}`);

  if (scheduleIds.length > 0) {
    await RevenueSchedule.updateMany({ _id: { $in: scheduleIds } }, { $set: { isRecognized: true } });
    await Invoice.findByIdAndUpdate(inv._id, { $inc: { recognizedRevenue: totalAmt } });
    await createVoucherForRevenueRecognition({
      amount: totalAmt,
      narration: "Test recognition — all due schedules",
      financialYearId: fyId,
      referenceType: "revenue_schedule",
      referenceId: scheduleIds[0],
    });
  }

  const { map } = await loadMap(fyId);
  const pnl = pnlFromMap(map);
  const rev = rowByName(map, "Revenue");

  pushIssue(issues, Math.abs(totalAmt - 12000) < EPS, `Schedules total should be 12000, got ${totalAmt}`);
  pushIssue(issues, Math.abs(pnl.revenue - 12000) < EPS, `Recognized revenue expected 12000, got ${pnl.revenue}`);
  pushIssue(issues, (rev?.credit ?? 0) > EPS, "Revenue account should have credits after recognition");
  pushIssue(issues, trialBalanceOk(map), "Trial balance debits ≠ credits");
  pushIssue(issues, balanceSheetEquation(map).balanced, "Balance sheet equation failed");

  return { scenario: "6_deferred_revenue", result: issues.length === 0 ? "pass" : "fail", issues };
}

async function main() {
  await connectDb();
  const fyId = await getActiveFy();
  const customer = await ensureCustomer();

  const report = [];

  const runners = [
    () => scenario1(fyId, customer._id),
    () => scenario2(fyId),
    () => scenario3(fyId),
    () => scenario4(fyId),
    () => scenario5(fyId),
    () => scenario6(fyId, customer._id),
  ];

  for (const run of runners) {
    await wipeTransactional();
    try {
      report.push(await run());
    } catch (e) {
      report.push({
        scenario: "unknown",
        result: "fail",
        issues: [String(e?.message || e)],
      });
    }
  }

  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
