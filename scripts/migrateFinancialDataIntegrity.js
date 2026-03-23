/**
 * Data cleanup: non-approved expense vouchers, orphan voucher lines, orphan reference vouchers.
 *
 * Usage (repo root):
 *   node scripts/migrateFinancialDataIntegrity.js
 *   node scripts/migrateFinancialDataIntegrity.js --dry-run
 */

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "../server/.env") });

const { connectDb } = require("../server/src/config/db");
const Voucher = require("../server/src/models/Voucher");
const VoucherEntry = require("../server/src/models/VoucherEntry");
const Expense = require("../server/src/models/Expense");
const Invoice = require("../server/src/models/Invoice");
const Payment = require("../server/src/models/Payment");
const Payslip = require("../server/src/models/Payslip");
const Employee = require("../server/src/models/Employee");

const dryRun = process.argv.includes("--dry-run");

async function deleteVoucherChain(voucherIds) {
  if (!voucherIds.length) return 0;
  await VoucherEntry.deleteMany({ voucherId: { $in: voucherIds } });
  const r = await Voucher.deleteMany({ _id: { $in: voucherIds } });
  return r.deletedCount || 0;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }
  await connectDb();

  let deletedVouchers = 0;

  // 1) Vouchers for expenses that are not approved
  const expenseVouchers = await Voucher.find({
    referenceType: "expense",
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id referenceId")
    .lean();

  const expenseIds = [...new Set(expenseVouchers.map((v) => v.referenceId))];
  const nonApproved = expenseIds.length
    ? await Expense.find({ _id: { $in: expenseIds }, status: { $ne: "approved" } }).select("_id").lean()
    : [];
  const badExpenseSet = new Set(nonApproved.map((e) => String(e._id)));
  const toDelExpense = expenseVouchers.filter((v) => badExpenseSet.has(String(v.referenceId))).map((v) => v._id);

  console.log(`[1] Non-approved expense vouchers: ${toDelExpense.length}`);
  if (!dryRun && toDelExpense.length) {
    deletedVouchers += await deleteVoucherChain(toDelExpense);
  }

  // 2) Orphan voucher lines (no parent voucher)
  const allVoucherIds = await Voucher.distinct("_id");
  const orphanEntryFilter =
    allVoucherIds.length > 0
      ? { voucherId: { $nin: allVoucherIds } }
      : { voucherId: { $exists: true } };
  const orphanEntries = await VoucherEntry.find(orphanEntryFilter).select("_id voucherId").lean();
  console.log(`[2] Orphan voucher entries (lines): ${orphanEntries.length}`);
  if (!dryRun && orphanEntries.length) {
    const r = await VoucherEntry.deleteMany({ _id: { $in: orphanEntries.map((e) => e._id) } });
    console.log(`    Deleted ${r.deletedCount} orphan line(s)`);
  }

  // 3) Vouchers referencing missing documents
  const withRef = await Voucher.find({
    referenceType: { $in: ["expense", "invoice", "payment", "payroll"] },
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id referenceType referenceId")
    .lean();

  const orphanRefIds = [];
  for (const v of withRef) {
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
      if (!exists) exists = !!(await Employee.findById(rid).select("_id").lean());
    }
    if (!exists) orphanRefIds.push(v._id);
  }

  console.log(`[3] Vouchers with broken references: ${orphanRefIds.length}`);
  if (!dryRun && orphanRefIds.length) {
    deletedVouchers += await deleteVoucherChain(orphanRefIds);
  }

  console.log(`\nDone.${dryRun ? " (dry-run — no writes)" : ""} Voucher documents removed (chains): ${deletedVouchers}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
