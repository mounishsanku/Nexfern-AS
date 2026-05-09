const mongoose = require("mongoose");

const taxProfileSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true },
    taxRules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TaxRule"
      }
    ],
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaxProfile", taxProfileSchema);
