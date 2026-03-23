const Invoice = require("../models/Invoice");
const FinancialYear = require("../models/FinancialYear");

/**
 * Backfill invoiceNumber for legacy rows (INV-YYYY-NNNN per financial year).
 */
async function migrateInvoiceNumbers() {
  const missing = await Invoice.find({
    $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }, { invoiceNumber: "" }],
  })
    .sort({ createdAt: 1 })
    .select("_id financialYearId createdAt")
    .lean();

  if (!missing.length) return;

  for (const inv of missing) {
    const fyId = inv.financialYearId;
    if (!fyId) {
      const year = inv.createdAt ? new Date(inv.createdAt).getUTCFullYear() : new Date().getUTCFullYear();
      const leg = String(inv._id).slice(-6).toUpperCase();
      await Invoice.updateOne({ _id: inv._id }, { $set: { invoiceNumber: `INV-${year}-LEG-${leg}` } });
      continue;
    }

    const fy = await FinancialYear.findByIdAndUpdate(
      fyId,
      { $inc: { nextInvoiceSequence: 1 } },
      { new: true },
    ).lean();

    if (!fy) {
      const year = inv.createdAt ? new Date(inv.createdAt).getUTCFullYear() : new Date().getUTCFullYear();
      await Invoice.updateOne(
        { _id: inv._id },
        { $set: { invoiceNumber: `INV-${year}-NOFY-${String(inv._id).slice(-4)}` } },
      );
      continue;
    }

    const year = new Date(fy.startDate).getUTCFullYear();
    const seq = String(fy.nextInvoiceSequence).padStart(4, "0");
    await Invoice.updateOne({ _id: inv._id }, { $set: { invoiceNumber: `INV-${year}-${seq}` } });
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate] Invoice numbers assigned: ${missing.length}`);
}

module.exports = { migrateInvoiceNumbers };
