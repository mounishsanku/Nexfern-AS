const mongoose = require("mongoose");

/**
 * Atomic daily sequence for voucher numbers: VCH-YYYYMMDD-XXXX (4-digit, zero-padded).
 */
const voucherSequenceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: false },
);

module.exports = mongoose.model("VoucherSequence", voucherSequenceSchema);
