const mongoose = require("mongoose");

const openingBalanceSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      required: true,
    },
    /** Canonical non-negative sides (either one positive per business rule, or both zero) */
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    /** Signed net (legacy); kept in sync with debit/credit */
    amount: { type: Number, required: true, default: 0 },
    /** Legacy aliases — synced with debit/credit on save */
    debitAmount: { type: Number, default: 0, min: 0 },
    creditAmount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

function pickSide(primary, legacy) {
  if (primary != null && primary !== "") {
    const n = Number(primary);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  const n = Number(legacy);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

openingBalanceSchema.pre("save", function preSaveOpening(next) {
  const d = pickSide(this.debit, this.debitAmount);
  const c = pickSide(this.credit, this.creditAmount);
  this.debit = d;
  this.credit = c;
  this.debitAmount = d;
  this.creditAmount = c;
  this.amount = Math.round((d - c) * 100) / 100;
  next();
});

// One opening balance per account per year
openingBalanceSchema.index({ accountId: 1, financialYearId: 1 }, { unique: true });

module.exports = mongoose.model("OpeningBalance", openingBalanceSchema);
