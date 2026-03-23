/**
 * Phase 1 — remove corrupted accounting artifacts while keeping valid invoices and approved expenses.
 *
 * Run: node scripts/hardResetCorruptedAccounting.js
 * Requires MONGODB_URI (server/.env).
 *
 * Deletes:
 * - Vouchers missing type/voucherNumber, <2 lines, or unbalanced lines; vouchers tied to non-approved expenses
 * - Orphan VoucherEntry
 * - Orphan BankTransaction (missing reference target)
 * - Orphan Payment (no payment voucher); then recomputes Invoice.paidAmount/status from remaining payments
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

const Voucher = require(path.join(serverRoot, "src", "models", "Voucher"));
const VoucherEntry = require(path.join(serverRoot, "src", "models", "VoucherEntry"));
const Expense = require(path.join(serverRoot, "src", "models", "Expense"));
const Invoice = require(path.join(serverRoot, "src", "models", "Invoice"));
const Payment = require(path.join(serverRoot, "src", "models", "Payment"));
const BankTransaction = require(path.join(serverRoot, "src", "models", "BankTransaction"));

const EPS = 0.02;

async function deleteVoucherCascade(voucherId) {
  await VoucherEntry.deleteMany({ voucherId });
  await Voucher.deleteOne({ _id: voucherId });
}

async function main() {
  await connectDb();
  const summary = { removedVouchers: 0, removedOrphanEntries: 0, removedBankTx: 0, removedPayments: 0 };

  // 1) Vouchers linked to non-approved expenses
  const expVouchers = await Voucher.find({
    referenceType: "expense",
    referenceId: { $exists: true, $ne: null },
  })
    .select("_id referenceId")
    .lean();
  for (const v of expVouchers) {
    const ex = await Expense.findById(v.referenceId).select("status").lean();
    if (!ex || ex.status !== "approved") {
      await deleteVoucherCascade(v._id);
      summary.removedVouchers += 1;
    }
  }

  // 2) Malformed vouchers
  const malformed = await Voucher.find({
    $or: [{ type: { $in: [null, ""] } }, { voucherNumber: { $in: [null, ""] } }],
  })
    .select("_id")
    .lean();
  for (const v of malformed) {
    await deleteVoucherCascade(v._id);
    summary.removedVouchers += 1;
  }

  // 3) Per-voucher line count / balance (remaining after steps 1–2)
  const allV = await Voucher.find({}).select("_id").lean();
  const ids = allV.map((x) => x._id);
  if (ids.length) {
    const agg = await VoucherEntry.aggregate([
      { $match: { voucherId: { $in: ids } } },
      {
        $group: {
          _id: "$voucherId",
          n: { $sum: 1 },
          td: { $sum: "$debit" },
          tc: { $sum: "$credit" },
        },
      },
    ]);
    const m = new Map(agg.map((r) => [String(r._id), r]));
    for (const vid of ids) {
      const row = m.get(String(vid));
      if (!row || row.n < 2 || Math.abs(Number(row.td) - Number(row.tc)) > EPS) {
        await deleteVoucherCascade(vid);
        summary.removedVouchers += 1;
      }
    }
  }

  // 4) Orphan voucher entries
  const orphanVe = await VoucherEntry.aggregate([
    { $lookup: { from: "vouchers", localField: "voucherId", foreignField: "_id", as: "v" } },
    { $match: { v: { $size: 0 } } },
    { $project: { _id: 1 } },
  ]);
  if (orphanVe.length) {
    await VoucherEntry.deleteMany({ _id: { $in: orphanVe.map((x) => x._id) } });
    summary.removedOrphanEntries = orphanVe.length;
  }

  // 5) Orphan bank transactions
  const txs = await BankTransaction.find({}).lean();
  for (const tx of txs) {
    let ok = true;
    const rt = String(tx.referenceType || "").toLowerCase();
    const rid = tx.referenceId;
    if (!rid) {
      ok = false;
    } else if (rt === "payment") {
      ok = !!(await Payment.findById(rid).select("_id").lean());
    } else if (rt === "expense") {
      ok = !!(await Expense.findById(rid).select("_id").lean());
    } else if (rt === "tds_payment") {
      ok = !!(await Voucher.findOne({ _id: rid, referenceType: "tds_payment" }).select("_id").lean());
    } else if (rt === "payroll") {
      const Payslip = require(path.join(serverRoot, "src", "models", "Payslip"));
      ok = !!(await Payslip.findById(rid).select("_id").lean());
    } else if (rt === "manual") {
      ok = true;
    }
    if (!ok) {
      await BankTransaction.deleteOne({ _id: tx._id });
      summary.removedBankTx += 1;
    }
  }

  // 6) Orphan payments (no voucher)
  const payments = await Payment.find({}).select("_id invoiceId amount").lean();
  for (const p of payments) {
    const v = await Voucher.findOne({ referenceType: "payment", referenceId: p._id }).select("_id").lean();
    if (!v) {
      await Payment.deleteOne({ _id: p._id });
      summary.removedPayments += 1;
    }
  }

  // 7) Recompute invoice paid amounts
  const invoices = await Invoice.find({}).select("_id totalAmount").lean();
  for (const inv of invoices) {
    const pays = await Payment.find({ invoiceId: inv._id }).lean();
    const paid = pays.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const total = Number(inv.totalAmount) || 0;
    const epsilon = 1e-6;
    let status = "unpaid";
    if (paid > epsilon) status = Math.abs(paid - total) <= epsilon ? "paid" : "partial";
    await Invoice.updateOne({ _id: inv._id }, { $set: { paidAmount: paid, status } });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
