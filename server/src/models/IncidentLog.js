const mongoose = require("mongoose");

const incidentLogSchema = new mongoose.Schema(
  {
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
      index: true
    },
    category: {
      type: String,
      required: true,
      index: true
    },
    source: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IncidentLog", incidentLogSchema);
