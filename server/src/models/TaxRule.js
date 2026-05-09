const mongoose = require("mongoose");

const taxRuleSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      required: true,
      index: true
    },
    country: { type: String, required: true, uppercase: true, trim: true },
    taxType: { type: String, required: true }, // GST, VAT, TDS, SALES_TAX
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0 },
    applicationType: { type: String, required: true }, // INVOICE, WITHHOLDING, REVERSE_CHARGE
    conditions: { type: Object, default: {} },
    metadata: { type: Object, default: {} },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaxRule", taxRuleSchema);
