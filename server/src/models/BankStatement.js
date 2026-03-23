const mongoose = require("mongoose");

const bankStatementSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    description: { type: String },
    amount: { type: Number, required: true },
    type: {
      type: String,
      required: true,
      enum: ["credit", "debit"],
      lowercase: true,
    },
    isMatched: { type: Boolean, default: false },
    matchedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchedAt: { type: Date, default: null },
    matchedReferenceType: {
      type: String,
      enum: ["payment", "expense"],
      default: null,
    },
    matchedReferenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankStatement", bankStatementSchema);
