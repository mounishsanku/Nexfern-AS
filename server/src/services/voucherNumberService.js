const VoucherSequence = require("../models/VoucherSequence");

/**
 * Next voucher number (atomic). Optional Mongo session for same multi-document transaction.
 * Format: VCH-YYYYMMDD-NNNN
 */
async function allocateVoucherNumber(session = null) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const key = `${y}${m}${d}`;

  const opts = { upsert: true, returnDocument: "after" };
  if (session) opts.session = session;

  const doc = await VoucherSequence.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    opts,
  ).exec();

  const n = String(doc.seq).padStart(4, "0");
  return `VCH-${key}-${n}`;
}

module.exports = { allocateVoucherNumber };
