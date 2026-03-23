/**
 * Destructive: clears transactional accounting data and resets operational bank balances.
 * Keeps: Customers, Vendors, chart Accounts, Users (and other master data not listed below).
 *
 * Run from repo root:
 *   node scripts/resetFinancialData.js
 *
 * Requires MONGODB_URI in server/.env
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
const BankTransaction = require(path.join(serverRoot, "src", "models", "BankTransaction"));
const OpeningBalance = require(path.join(serverRoot, "src", "models", "OpeningBalance"));
const BankAccount = require(path.join(serverRoot, "src", "models", "BankAccount"));

async function main() {
  await connectDb();

  const ve = await VoucherEntry.deleteMany({});
  const v = await Voucher.deleteMany({});
  const bt = await BankTransaction.deleteMany({});
  const ob = await OpeningBalance.deleteMany({});
  const ba = await BankAccount.updateMany({}, { $set: { balance: 0 } });

  // eslint-disable-next-line no-console
  console.log("resetFinancialData:", {
    deletedVoucherEntries: ve.deletedCount,
    deletedVouchers: v.deletedCount,
    deletedBankTransactions: bt.deletedCount,
    deletedOpeningBalances: ob.deletedCount,
    bankAccountsBalanceReset: ba.modifiedCount,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
