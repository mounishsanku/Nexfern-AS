const mongoose = require("mongoose");

const exchangeRateSchema = new mongoose.Schema(
  {
    fromCurrency: { type: String, required: true, uppercase: true, trim: true },
    toCurrency: { type: String, required: true, uppercase: true, trim: true },
    rate: { type: Number, required: true, min: [0.000001, "Rate must be > 0"] },
    source: { type: String, default: "manual" },
    effectiveDate: { type: Date, required: true },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

exchangeRateSchema.index({ fromCurrency: 1, toCurrency: 1, effectiveDate: -1 });

module.exports = mongoose.model("ExchangeRate", exchangeRateSchema);
