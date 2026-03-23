const mongoose = require("mongoose");

const financialYearSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "2025-26"
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },
    isClosed:  { type: Boolean, default: false },
    closedAt:  { type: Date, default: null },
    openingBalance: {
      cash:         { type: Number, default: 0 },
      bank:         { type: Number, default: 0 },
      receivables:  { type: Number, default: 0 },
      equity:       { type: Number, default: 0 },
    },
    /** Monotonic per FY — used for INV-YYYY-NNNN */
    nextInvoiceSequence: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FinancialYear", financialYearSchema);
