const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      required: true,
      enum: ["cash", "bank", "upi"],
      lowercase: true,
    },
    reference: { type: String, default: null, trim: true },
    /** Operational bank account (maps to GL Cash vs Bank); null = default Cash wallet */
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    matched: { type: Boolean, default: false },
    date: { type: Date, default: Date.now },
    isReversed: { type: Boolean, default: false },
  },
  { timestamps: false },
);

paymentSchema.index({ invoiceId: 1, date: -1 });

module.exports = mongoose.model("Payment", paymentSchema);

