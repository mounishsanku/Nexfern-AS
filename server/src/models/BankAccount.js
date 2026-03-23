const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    accountNumber: { type: String, default: null, trim: true },
    balance: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

bankAccountSchema.index({ name: 1 });

module.exports = mongoose.model("BankAccount", bankAccountSchema);

