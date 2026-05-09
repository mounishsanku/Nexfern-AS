/**
 * ReconciliationMatch.js — a single proposed or confirmed match between two records.
 *
 * SAFETY RULES:
 *  - Matches in "suggested" status NEVER auto-mutate accounting records.
 *  - Only "confirmed" matches may trigger downstream settlement (via controller).
 *  - Reversals set status → "reversed" and preserve full history (never deleted).
 *  - confidenceScore: 0–100 (deterministic rule-based, no ML).
 */
const mongoose = require("mongoose");

const reconciliationMatchSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReconciliationSession",
      required: true,
      index: true,
    },
    // Left side: typically the bank statement / imported bank transaction
    leftType: {
      type: String,
      required: true,
      enum: ["bank_statement", "bank_transaction", "bank_feed"],
    },
    leftId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    // Right side: the internal ledger record
    rightType: {
      type: String,
      required: true,
      enum: ["payment", "expense", "invoice", "bank_transaction"],
    },
    rightId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },
    status: {
      type: String,
      enum: ["suggested", "confirmed", "rejected", "reversed"],
      default: "suggested",
      index: true,
    },
    matchedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reversedAt: { type: Date },
    // Explainability: why this match was scored the way it was
    scoringBreakdown: {
      amountScore: { type: Number, default: 0 },
      dateScore: { type: Number, default: 0 },
      referenceScore: { type: Number, default: 0 },
      invoiceScore: { type: Number, default: 0 },
      partyScore: { type: Number, default: 0 },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Prevent duplicate matches within the same session for the same pair
reconciliationMatchSchema.index(
  { sessionId: 1, leftId: 1, rightId: 1 },
  { unique: true }
);

module.exports = mongoose.model("ReconciliationMatch", reconciliationMatchSchema);
