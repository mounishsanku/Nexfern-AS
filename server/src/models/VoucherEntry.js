const mongoose = require("mongoose");

const voucherEntrySchema = new mongoose.Schema(
  {
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      required: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    debit:  { type: Number, required: true, default: 0, min: 0 },
    credit: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: false }
);

voucherEntrySchema.index({ voucherId: 1 });
voucherEntrySchema.index({ accountId: 1 });

module.exports = mongoose.model("VoucherEntry", voucherEntrySchema);
