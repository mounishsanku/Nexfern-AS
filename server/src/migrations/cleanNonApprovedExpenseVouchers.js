/**
 * Clean vouchers that reference expenses with status !== "approved".
 * Only approved expenses should have vouchers; pending/rejected must not affect accounting.
 *
 * Run: node -r dotenv/config src/migrations/cleanNonApprovedExpenseVouchers.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Voucher = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const Expense = require("../models/Expense");

async function cleanNonApprovedExpenseVouchers() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const expenseVouchers = await Voucher.find({
    referenceType: "expense",
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id voucherNumber referenceId")
    .lean();

  if (!expenseVouchers.length) {
    console.log("No expense vouchers found. Nothing to clean.");
    await mongoose.disconnect();
    return;
  }

  const expenseIds = [...new Set(expenseVouchers.map((v) => v.referenceId))];
  const nonApproved = await Expense.find({
    _id: { $in: expenseIds },
    status: { $ne: "approved" },
  })
    .select("_id status title")
    .lean();

  const nonApprovedSet = new Set(nonApproved.map((e) => String(e._id)));
  const vouchersToDelete = expenseVouchers.filter((v) =>
    nonApprovedSet.has(String(v.referenceId)),
  );

  if (!vouchersToDelete.length) {
    console.log("All expense vouchers reference approved expenses. Nothing to clean.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${vouchersToDelete.length} voucher(s) linked to non-approved expenses:`);
  for (const v of vouchersToDelete) {
    const exp = nonApproved.find((e) => String(e._id) === String(v.referenceId));
    console.log(`  - ${v.voucherNumber} → expense ${v.referenceId} (${exp?.status ?? "?"}) ${exp?.title ?? ""}`);
  }

  const voucherIds = vouchersToDelete.map((v) => v._id);
  await VoucherEntry.deleteMany({ voucherId: { $in: voucherIds } });
  const result = await Voucher.deleteMany({ _id: { $in: voucherIds } });
  console.log(`Deleted ${result.deletedCount} voucher(s) and their entries.`);
  await mongoose.disconnect();
}

cleanNonApprovedExpenseVouchers().catch((err) => {
  console.error(err);
  process.exit(1);
});
