/**
 * DESTRUCTIVE: clears Voucher, VoucherEntry, Invoice, Payment, Expense (and related bank rows),
 * then creates one demo invoice, full payment, and one expense — all with vouchers only.
 *
 * From repo root (requires MONGODB_URI in server/.env):
 *   node scripts/seedCleanAccountingDemo.js
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

const {
  createVoucherForInvoice,
  createVoucherForPayment,
  createVoucherForExpense,
} = require(path.join(serverRoot, "src", "services", "voucherService"));
const { recordBankTransaction } = require(path.join(serverRoot, "src", "services", "bankService"));

async function main() {
  await connectDb();

  const rs = await RevenueSchedule.deleteMany({});
  const pym = await Payment.deleteMany({});
  const exp = await Expense.deleteMany({});
  const inv = await Invoice.deleteMany({});
  const ve = await VoucherEntry.deleteMany({});
  const v = await Voucher.deleteMany({});
  const bt = await BankTransaction.deleteMany({});
  const ob = await OpeningBalance.deleteMany({});
  await BankAccount.updateMany({}, { $set: { balance: 0 } });

  // eslint-disable-next-line no-console
  console.log("seedCleanAccountingDemo: cleared", {
    revenueSchedules: rs.deletedCount,
    payments: pym.deletedCount,
    expenses: exp.deletedCount,
    invoices: inv.deletedCount,
    voucherEntries: ve.deletedCount,
    vouchers: v.deletedCount,
    bankTransactions: bt.deletedCount,
    openingBalances: ob.deletedCount,
  });

  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  if (!fy) {
    // eslint-disable-next-line no-console
    console.error("No active financial year — start the server once to seed FY or create one in the app.");
    process.exit(1);
  }
  const financialYearId = fy._id;

  let customer = await Customer.findOne().lean();
  if (!customer) {
    customer = await Customer.create({ name: "Demo Customer", email: "demo@example.com" });
  }

  const taxable = 10000;
  const invoice = await Invoice.create({
    customer: customer._id,
    amount: taxable,
    financialYearId,
    gstType: "CGST_SGST",
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalAmount: taxable,
    paidAmount: 0,
    status: "unpaid",
    isDeferred: false,
    revenueType: "project",
    department: "tech",
    createdAt: new Date(),
  });

  await createVoucherForInvoice({ invoice, financialYearId });

  const payment = await Payment.create({
    invoiceId: invoice._id,
    amount: taxable,
    method: "cash",
    reference: "SEED-001",
    financialYearId,
    date: new Date(),
  });

  await createVoucherForPayment({ payment, financialYearId });
  await recordBankTransaction({
    bankAccountId: null,
    type: "credit",
    amount: payment.amount,
    referenceType: "payment",
    referenceId: payment._id,
  });

  invoice.paidAmount = taxable;
  invoice.status = "paid";
  await invoice.save();

  const expenseDate = new Date();
  expenseDate.setUTCHours(0, 0, 0, 0);
  const expense = await Expense.create({
    title: "Seed office expense",
    amount: 500,
    category: "utilities",
    department: "tech",
    date: expenseDate,
    financialYearId,
    tdsApplicable: false,
    createdAt: new Date(),
  });

  await createVoucherForExpense({ expense, financialYearId });
  await recordBankTransaction({
    bankAccountId: null,
    type: "debit",
    amount: expense.amount,
    referenceType: "expense",
    referenceId: expense._id,
  });

  // eslint-disable-next-line no-console
  console.log("seedCleanAccountingDemo: created demo invoice, payment, expense (vouchers + bank ops)", {
    invoiceId: String(invoice._id),
    paymentId: String(payment._id),
    expenseId: String(expense._id),
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
