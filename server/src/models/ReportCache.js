/**
 * ReportCache.js — cached snapshots of expensive report computations.
 *
 * SAFETY RULES:
 *  - Cached payloads MUST derive from trusted accounting sources (reportController/analyticsEngine).
 *  - Cache is always keyed by filtersHash to prevent stale cross-entity pollution.
 *  - Expired caches are never auto-served — callers must check expiresAt.
 *  - status "stale" signals to diagnostics that a refresh is needed.
 */
const mongoose = require("mongoose");
const crypto = require("crypto");

const reportCacheSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      index: true,
      default: null,
    },
    reportType: {
      type: String,
      required: true,
      index: true,
      // e.g. "kpi_summary", "pnl", "cashflow", "balance_sheet", "receivables_aging", "tax_summary"
    },
    /** SHA-256 of the serialized filter params — cache key uniqueness */
    filtersHash: {
      type: String,
      required: true,
      index: true,
    },
    generatedAt: { type: Date, default: Date.now },
    expiresAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["fresh", "stale", "error"],
      default: "fresh",
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** The actual computed report data — can be large */
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Compound index for fast cache lookup
reportCacheSchema.index({ reportType: 1, filtersHash: 1, entityId: 1 }, { unique: true });

// TTL index — MongoDB auto-deletes after expiresAt (safety net for orphaned caches)
reportCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Generates a deterministic SHA-256 hash from a filters object.
 * Used as the cache key component.
 */
function hashFilters(filters = {}) {
  const normalized = JSON.stringify(
    Object.keys(filters).sort().reduce((acc, k) => { acc[k] = filters[k]; return acc; }, {})
  );
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

module.exports = mongoose.model("ReportCache", reportCacheSchema);
module.exports.hashFilters = hashFilters;
