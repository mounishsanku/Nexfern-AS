const mongoose = require("mongoose");

const currencySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    symbol: { type: String, default: "" },
    decimals: { type: Number, default: 2, min: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Currency", currencySchema);
