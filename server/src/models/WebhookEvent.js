/**
 * WebhookEvent.js — immutable log of all incoming webhook payloads.
 *
 * SECURITY RULES:
 * - payloadHash enables replay detection
 * - raw secrets/tokens must NEVER be stored here
 * - status transitions are one-directional
 */
const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    payloadHash: {
      type: String,
      required: true,
      unique: true, // replay detection: duplicate hashes are blocked
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processed", "failed", "replay_blocked"],
      default: "pending",
      index: true,
    },
    replayDetected: { type: Boolean, default: false },
    signatureValid: { type: Boolean, default: false },
    processedAt: { type: Date },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);

