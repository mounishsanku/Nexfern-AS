const mongoose = require("mongoose");
const VoucherEntry = require("../models/VoucherEntry");
const Voucher = require("../models/Voucher");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const Invoice = require("../models/Invoice");
const OpeningBalance = require("../models/OpeningBalance");
const Account = require("../models/Account");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const FinancialYear = require("../models/FinancialYear");

function stripDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const o = { ...doc };
  delete o.__v;
  return o;
}

function stripDocs(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(stripDoc);
}

async function clearFinanceCollections(session) {
  const opts = session ? { session } : {};
  await VoucherEntry.deleteMany({}, opts);
  await Voucher.deleteMany({}, opts);
  await Payment.deleteMany({}, opts);
  await Expense.deleteMany({}, opts);
  await Invoice.deleteMany({}, opts);
  await OpeningBalance.deleteMany({}, opts);
  await Account.deleteMany({}, opts);
  await Customer.deleteMany({}, opts);
  await Vendor.deleteMany({}, opts);
  await FinancialYear.deleteMany({}, opts);
}

async function insertManySafe(Model, docs, session) {
  const list = stripDocs(docs);
  if (!list.length) return { inserted: 0 };
  const opts = session ? { session } : {};
  await Model.insertMany(list, { ...opts, ordered: true });
  return { inserted: list.length };
}

/** Single-doc create for merge — duplicate key → skip */
async function mergeInsertOne(Model, doc, session) {
  const d = stripDoc(doc);
  try {
    const opts = session ? { session } : {};
    await Model.create(d, opts);
    return "inserted";
  } catch (e) {
    if (e && (e.code === 11000 || e.code === 11001)) return "skipped";
    throw e;
  }
}

async function mergeAll(Model, docs, session) {
  const list = stripDocs(docs);
  let inserted = 0;
  let skipped = 0;
  for (const doc of list) {
    const r = await mergeInsertOne(Model, doc, session);
    if (r === "inserted") inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

/**
 * Restore from backup payload (version 1 or 2).
 * @param {object} backup
 * @param {"clear"|"merge"} mode
 * @param {import('mongoose').ClientSession|null} session
 */
async function applyRestore(backup, mode, session) {
  const v = Number(backup.version) || 1;
  const fy = Array.isArray(backup.financialYears) ? backup.financialYears : [];
  const customers = Array.isArray(backup.customers) ? backup.customers : [];
  const vendors = Array.isArray(backup.vendors) ? backup.vendors : [];
  const accounts = Array.isArray(backup.accounts) ? backup.accounts : [];
  const openingBalances = Array.isArray(backup.openingBalances) ? backup.openingBalances : [];
  const invoices = Array.isArray(backup.invoices) ? backup.invoices : [];
  const payments = Array.isArray(backup.payments) ? backup.payments : [];
  const expenses = Array.isArray(backup.expenses) ? backup.expenses : [];
  const vouchers = Array.isArray(backup.vouchers) ? backup.vouchers : [];
  const voucherEntries = Array.isArray(backup.voucherEntries) ? backup.voucherEntries : [];

  if (v < 1) {
    const err = new Error("Invalid backup version");
    err.code = "RESTORE_INVALID_VERSION";
    throw err;
  }

  const stats = {
    mode,
    version: v,
    financialYears: 0,
    customers: 0,
    vendors: 0,
    accounts: 0,
    openingBalances: 0,
    invoices: 0,
    payments: 0,
    expenses: 0,
    vouchers: 0,
    voucherEntries: 0,
    mergeSkipped: 0,
  };

  if (mode === "clear") {
    await clearFinanceCollections(session);
  }

  const insert = mode === "clear" ? insertManySafe : mergeAll;

  let r;

  if (v >= 2 && fy.length) {
    r = await insert(FinancialYear, fy, session);
    stats.financialYears = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (v >= 2 && customers.length) {
    r = await insert(Customer, customers, session);
    stats.customers = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (v >= 2 && vendors.length) {
    r = await insert(Vendor, vendors, session);
    stats.vendors = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (accounts.length) {
    r = await insert(Account, accounts, session);
    stats.accounts = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (openingBalances.length) {
    r = await insert(OpeningBalance, openingBalances, session);
    stats.openingBalances = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (invoices.length) {
    r = await insert(Invoice, invoices, session);
    stats.invoices = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (payments.length) {
    r = await insert(Payment, payments, session);
    stats.payments = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (expenses.length) {
    r = await insert(Expense, expenses, session);
    stats.expenses = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (vouchers.length) {
    r = await insert(Voucher, vouchers, session);
    stats.vouchers = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  if (voucherEntries.length) {
    r = await insert(VoucherEntry, voucherEntries, session);
    stats.voucherEntries = r.inserted;
    stats.mergeSkipped += r.skipped || 0;
  }

  return stats;
}

/**
 * Run restore inside a transaction when the deployment supports it (replica set).
 */
async function runRestoreTransactional(backup, mode) {
  const session = await mongoose.startSession();
  try {
    let stats;
    await session.withTransaction(async () => {
      stats = await applyRestore(backup, mode, session);
    });
    return { ok: true, transactional: true, stats };
  } catch (err) {
    const msg = String(err?.message || err);
    const noTxn =
      err?.code === 20 ||
      err?.codeName === "IllegalOperation" ||
      /transaction/i.test(msg) ||
      /replica set/i.test(msg) ||
      /Transaction numbers are only allowed/i.test(msg);

    if (noTxn) {
      return {
        ok: false,
        transactional: false,
        code: "TRANSACTION_UNSUPPORTED",
        message:
          "MongoDB transactions are not available (standalone server). Retry with allowNonTransactional=true or use a replica set.",
        cause: msg,
      };
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/** Non-transactional restore: clear then insert (risky if insert fails mid-way). */
async function runRestoreNonTransactional(backup, mode) {
  const stats = await applyRestore(backup, mode, null);
  return { ok: true, transactional: false, stats };
}

module.exports = {
  applyRestore,
  runRestoreTransactional,
  runRestoreNonTransactional,
  clearFinanceCollections,
};
