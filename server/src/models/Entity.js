const mongoose = require("mongoose");

const entitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    country: { type: String, required: true }, // ISO country code
    baseCurrency: { type: String, required: true },
    fiscalYearStartMonth: { type: Number, default: 4 },
    gstin: { type: String, trim: true },
    eInvoiceConfig: {
      username: { type: String },
      password: { type: String },
      appKey: { type: String },
      clientId: { type: String },
      clientSecret: { type: String },
    },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

entitySchema.index({ country: 1 });

module.exports = mongoose.model("Entity", entitySchema);
