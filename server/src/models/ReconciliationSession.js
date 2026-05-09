/**
 * ReconciliationSession.js — tracks one reconciliation run.
 * A session groups all matches produced in one reconciliation pass.
 * Sessions are immutable once completed — never delete historical sessions.
 */
const mongoose = require("mongoose");

const reconciliationSessionSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["bank", "payment", "invoice"],
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "completed", "cancelled"],
      default: "open",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    summary: {
      totalCandidates: { type: Number, default: 0 },
      matched: { type: Number, default: 0 },
      confirmed: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      unmatched: { type: Number, default: 0 },
      discrepancies: { type: Number, default: 0 },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReconciliationSession", reconciliationSessionSchema);
