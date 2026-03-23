const mongoose = require("mongoose");

const bankTransactionSchema = new mongoose.Schema(
  {
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["credit", "debit"],
      lowercase: true,
    },
    amount: { type: Number, required: true, min: 0 },
    referenceType: {
      type: String,
      required: true,
      enum: ["payment", "expense", "manual", "tds_payment", "payroll"],
      lowercase: true,
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      default: null,
    },
    date: { type: Date, default: Date.now },
    isMatched: { type: Boolean, default: false },
    isReconciled: { type: Boolean, default: false },
  },
  { timestamps: false },
);

bankTransactionSchema.index({ bankAccountId: 1, date: -1 });
bankTransactionSchema.index({ isReconciled: 1 });

module.exports = mongoose.model("BankTransaction", bankTransactionSchema);

