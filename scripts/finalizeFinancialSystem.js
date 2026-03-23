/**
 * Final data correction + stabilization (run once per environment after backup).
 *
 * 1) Remove invalid / non-approved-linked expense vouchers
 * 2) Remove vouchers missing type or voucherNumber
 * 3) Remove orphan VoucherEntry rows
 * 4) Mark all BankTransaction isReconciled = true (cleanup phase)
 * 5) Bank–GL alignment loop
 * 6) Capital injection for negative operational wallets + GL
 * 7) Optional balance-sheet plug voucher
 *
 * Usage (repo root):
 *   node scripts/finalizeFinancialSystem.js
 *   node scripts/finalizeFinancialSystem.js --dry-run
 */

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "../server/.env") });

const { connectDb } = require("../server/src/config/db");
const Voucher = require("../server/src/models/Voucher");
const VoucherEntry = require("../server/src/models/VoucherEntry");
const Expense = require("../server/src/models/Expense");
const BankTransaction = require("../server/src/models/BankTransaction");
const FinancialYear = require("../server/src/models/FinancialYear");
const {
  runBankGlAlignmentLoop,
  repairNegativeOperationalWithCapital,
  createBalanceSheetPlugIfNeeded,
  computeBankGlDiff,
} = require("../server/src/services/bankGlConsistencyService");
const { seedDefaultAccounts } = require("../server/src/controllers/accountController");

const dryRun = process.argv.includes("--dry-run");

async function collectVoucherIdsToDelete() {
  const ids = new Set();

  const missingMeta = await Voucher.find({
    $or: [
      { type: { $in: [null, ""] } },
      { voucherNumber: { $in: [null, ""] } },
      { type: { $exists: false } },
      { voucherNumber: { $exists: false } },
    ],
  })
    .select("_id")
    .lean();
  for (const v of missingMeta) ids.add(String(v._id));

  const expenseVouchers = await Voucher.find({
    referenceType: "expense",
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id referenceId")
    .lean();
  const eids = [...new Set(expenseVouchers.map((x) => String(x.referenceId)))];
  const nonApproved = eids.length
    ? await Expense.find({ _id: { $in: eids }, status: { $ne: "approved" } }).select("_id").lean()
    : [];
  const bad = new Set(nonApproved.map((e) => String(e._id)));
  for (const v of expenseVouchers) {
    if (bad.has(String(v.referenceId))) ids.add(String(v._id));
  }

  const requiringRef = ["expense", "invoice", "payment", "payroll"];
  const brokenRef = await Voucher.find({
    referenceType: { $in: requiringRef },
    $or: [{ referenceId: null }, { referenceId: { $exists: false } }],
  })
    .select("_id")
    .lean();
  for (const v of brokenRef) ids.add(String(v._id));

  return [...ids].map((s) => new mongoose.Types.ObjectId(s));
}

async function deleteVoucherChains(voucherIds) {
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
  await seedDefaultAccounts();

  const fy = await FinancialYear.findOne({ isClosed: false }).sort({ startDate: -1 }).lean();
  const financialYearId = fy?._id ?? null;
  if (!financialYearId) {
    console.warn("No open financial year — skipping alignment / plug / capital repair.");
  }

  const toDel = await collectVoucherIdsToDelete();
  console.log(`[1] Voucher chains to remove: ${toDel.length}`);
  if (!dryRun && toDel.length) {
    const n = await deleteVoucherChains(toDel);
    console.log(`    Deleted ${n} voucher(s) + lines.`);
  }

  const allVid = await Voucher.distinct("_id");
  const orphanFilter =
    allVid.length > 0 ? { voucherId: { $nin: allVid } } : { voucherId: { $exists: true } };
  const orphanLines = await VoucherEntry.countDocuments(orphanFilter);
  console.log(`[2] Orphan VoucherEntry rows: ${orphanLines}`);
  if (!dryRun && orphanLines) {
    const r = await VoucherEntry.deleteMany(orphanFilter);
    console.log(`    Deleted ${r.deletedCount} line(s).`);
  }

  const txCount = await BankTransaction.countDocuments({});
  console.log(`[3] Mark all bank transactions reconciled: ${txCount} row(s)`);
  if (!dryRun && txCount) {
    await BankTransaction.updateMany({}, { $set: { isReconciled: true } });
    console.log("    Updated.");
  }

  if (financialYearId && !dryRun) {
    console.log("[4] Bank–GL alignment loop…");
    const { passes, diff } = await runBankGlAlignmentLoop(financialYearId, 8);
    console.log(`    Passes: ${passes}, delta after: ${diff.delta}`);

    console.log("[5] Negative operational + GL capital injection…");
    const cap = await repairNegativeOperationalWithCapital(financialYearId);
    console.log(`    Wallets repaired: ${cap.repaired}`);

    const again = await runBankGlAlignmentLoop(financialYearId, 5);
    console.log(`[6] Re-align passes: ${again.passes}, delta: ${again.diff.delta}`);

    console.log("[7] Balance sheet plug (if needed)…");
    const plug = await createBalanceSheetPlugIfNeeded(financialYearId);
    console.log(`    Plugged: ${plug.plugged}, gap: ${plug.gap}`);
  } else if (dryRun) {
    console.log("[4-7] Skipped (dry-run or no FY)");
  }

  if (financialYearId) {
    const d = await computeBankGlDiff();
    console.log("\nFinal bank–GL delta (ops − GL):", d.delta);
  }

  console.log(dryRun ? "\nDry-run complete (no writes)." : "\nFinalize complete.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
