const mongoose = require("mongoose");

const milestoneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    isCompleted: { type: Boolean, default: false },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    totalValue: { type: Number, required: true, min: 0 },
    milestones: { type: [milestoneSchema], default: [] },
  },
  { timestamps: true }
);

projectSchema.index({ clientId: 1, createdAt: -1 });

module.exports = mongoose.model("Project", projectSchema);
