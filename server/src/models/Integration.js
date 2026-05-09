/**
 * Integration.js — represents a third-party provider connection for an entity.
 *
 * SECURITY: credentials field is always stored encrypted via encryptionService.
 * NEVER return raw credentials in API responses.
 */
const mongoose = require("mongoose");

const integrationSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: ["razorpay", "stripe", "bank-feed", "zoho", "salesforce"],
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["payment_gateway", "bank_feed", "crm", "erp"],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "error", "pending"],
      default: "inactive",
      index: true,
    },
    /** AES-256 encrypted blob — never return in API responses */
    credentials: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastSyncAt: { type: Date },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Integration", integrationSchema);
