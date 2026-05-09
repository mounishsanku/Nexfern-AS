/**
 * Simple controller tests for POST /api/payments (createPayment).
 *
 * Run:
 *   node scripts/paymentControllerApiTests.js
 *
 * Prints JSON results and exits non-zero on failures.
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

const { seedDefaultAccounts } = require(path.join(serverRoot, "src", "controllers", "accountController"));
const { seedActiveYear } = require(path.join(serverRoot, "src", "controllers", "financialYearController"));

const Invoice = require(path.join(serverRoot, "src", "models", "Invoice"));
const Payment = require(path.join(serverRoot, "src", "models", "Payment"));
const Expense = require(path.join(serverRoot, "src", "models", "Expense"));
const VoucherEntry = require(path.join(serverRoot, "src", "models", "VoucherEntry"));
const Voucher = require(path.join(serverRoot, "src", "models", "Voucher"));
const BankTransaction = require(path.join(serverRoot, "src", "models", "BankTransaction"));
const OpeningBalance = require(path.join(serverRoot, "src", "models", "OpeningBalance"));
const BankAccount = require(path.join(serverRoot, "src", "models", "BankAccount"));
const Customer = require(path.join(serverRoot, "src", "models", "Customer"));
const FinancialYear = require(path.join(serverRoot, "src", "models", "FinancialYear"));

const { createVoucherForInvoice } = require(path.join(serverRoot, "src", "services", "voucherService"));
const { createPayment } = require(path.join(serverRoot, "src", "controllers", "paymentController"));

function makeResCapture() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
    send(body) {
      out.body = body;
      return this;
    },
    get result() {
      return out;
    },
  };
}

async function getActiveFyId() {
  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  if (!fy) throw new Error("No active financial year");
  return fy._id;
}

async function ensureCustomer() {
  let c = await Customer.findOne().lean();
  if (!c) {
    c = await Customer.create({ name: "Test Customer", email: "payments-tests@example.com" });
  }
  return c;
}

async function wipeTransactional() {
  await Payment.deleteMany({});
  await Expense.deleteMany({});
  await Invoice.deleteMany({});
  await VoucherEntry.deleteMany({});
  await Voucher.deleteMany({});
  await BankTransaction.deleteMany({});
  await OpeningBalance.deleteMany({});
  await BankAccount.updateMany({}, { $set: { balance: 0 } });
}

async function main() {
  await connectDb();
  await seedDefaultAccounts();
  await seedActiveYear();

  const fyId = await getActiveFyId();
  const customer = await ensureCustomer();

  const results = [];

  // ---------------------------------------------------------------------------
  // Test 1: valid payment -> success
  // ---------------------------------------------------------------------------
  await wipeTransactional();
  const inv1 = await Invoice.create({
    customer: customer._id,
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
  await createVoucherForInvoice({ invoice: inv1, financialYearId: fyId });

  {
    const req = {
      user: { sub: "payments-test-user" },
      activeYear: { _id: fyId },
      body: {
        invoiceId: String(inv1._id),
        amount: 4000,
        method: "cash",
        reference: "PAY-TEST-1",
        bankAccountId: null,
      },
    };
    const res = makeResCapture();
    await createPayment(req, res);

    const invAfter = await Invoice.findById(inv1._id).lean();
    const ok =
      res.result.statusCode === 201 &&
      res.result.body &&
      res.result.body.amount === 4000 &&
      invAfter.paidAmount === 4000 &&
      invAfter.status === "partial";

    results.push({ scenario: "valid_payment", ok, result: res.result });
    if (!ok) console.error("valid_payment failed:", res.result);
  }

  // ---------------------------------------------------------------------------
  // Test 2: duplicate -> handled (2nd identical full payment blocked)
  // ---------------------------------------------------------------------------
  await wipeTransactional();
  const inv2 = await Invoice.create({
    customer: customer._id,
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
  await createVoucherForInvoice({ invoice: inv2, financialYearId: fyId });

  {
    const reqBase = {
      user: { sub: "payments-test-user" },
      activeYear: { _id: fyId },
      body: {
        invoiceId: String(inv2._id),
        amount: 10000,
        method: "cash",
        reference: "PAY-TEST-DUP",
        bankAccountId: null,
      },
    };

    const res1 = makeResCapture();
    await createPayment(reqBase, res1);

    const res2 = makeResCapture();
    await createPayment(reqBase, res2);

    const ok =
      res1.result.statusCode === 201 &&
      res2.result.statusCode === 400 &&
      res2.result.body &&
      res2.result.body.code === "INVALID_PAYMENT";

    results.push({ scenario: "duplicate_full_payment", ok, result: { first: res1.result, second: res2.result } });
    if (!ok) console.error("duplicate_full_payment failed:", { first: res1.result, second: res2.result });
  }

  // ---------------------------------------------------------------------------
  // Test 3: invalid amount -> blocked (exceeds remaining)
  // ---------------------------------------------------------------------------
  await wipeTransactional();
  const inv3 = await Invoice.create({
    customer: customer._id,
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
  await createVoucherForInvoice({ invoice: inv3, financialYearId: fyId });

  {
    const req = {
      user: { sub: "payments-test-user" },
      activeYear: { _id: fyId },
      body: {
        invoiceId: String(inv3._id),
        amount: 10001, // exceeds remaining (10000)
        method: "cash",
        reference: "PAY-TEST-INVALID-AMT",
        bankAccountId: null,
      },
    };
    const res = makeResCapture();
    await createPayment(req, res);

    const ok =
      res.result.statusCode === 400 &&
      res.result.body &&
      res.result.body.code === "INVALID_PAYMENT";

    // Hard requirement: no 500 errors in these cases.
    const no500 = res.result.statusCode !== 500;

    results.push({ scenario: "invalid_amount_blocked", ok: ok && no500, result: res.result });
    if (!ok || !no500) console.error("invalid_amount_blocked failed:", res.result);
  }

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ passed, total, results }, null, 2));

  if (passed !== total) {
    process.exit(1);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

