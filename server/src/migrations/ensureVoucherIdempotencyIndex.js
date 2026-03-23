/**
 * Ensures the voucher idempotency unique index exists.
 * Run before deploying: node -r dotenv/config src/migrations/ensureVoucherIdempotencyIndex.js
 *
 * If duplicates exist, this will fail. Run cleanNonApprovedExpenseVouchers first if needed.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const Voucher = require("../models/Voucher");

async function run() {
  await connectDb();

  const dupes = await Voucher.aggregate([
    { $match: { referenceType: { $ne: null }, referenceId: { $ne: null } } },
    { $group: { _id: { referenceType: "$referenceType", referenceId: "$referenceId" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (dupes.length > 0) {
    console.error("Duplicate vouchers found (referenceType, referenceId). Resolve before creating index:");
    console.error(dupes);
    process.exitCode = 1;
  } else {
    await Voucher.collection.createIndex(
      { referenceType: 1, referenceId: 1 },
      { unique: true, partialFilterExpression: { referenceType: { $exists: true, $type: "string", $gt: "" }, referenceId: { $exists: true, $type: "objectId" } } }
    );
    console.log("Voucher idempotency index created.");
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
