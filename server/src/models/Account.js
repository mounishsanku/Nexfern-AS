const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true, unique: true },
    type:     { type: String, required: true, enum: ["asset", "liability", "equity", "revenue", "expense"] },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

accountSchema.index({ type: 1 });

module.exports = mongoose.model("Account", accountSchema);
