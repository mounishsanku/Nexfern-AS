/**
 * SystemMetric.js — time-series operational metrics store.
 * Lightweight — no separate timeseries DB required at this scale.
 * Uses a TTL index to auto-purge metrics older than 30 days.
 */
const mongoose = require("mongoose");

const systemMetricSchema = new mongoose.Schema(
  {
    metricType: {
      type: String,
      required: true,
      index: true,
      // e.g. "http_latency", "report_generation_ms", "cache_hit", "cache_miss",
      //      "webhook_failure", "import_failure", "db_query_ms", "reconciliation_ms"
    },
    value: { type: Number, required: true },
    labels: {
      // Arbitrary key-value tags for filtering (route, provider, reportType, etc.)
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Compound index for time-range queries per metric type
systemMetricSchema.index({ metricType: 1, timestamp: -1 });

// Auto-purge after 30 days
systemMetricSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 86400 });

module.exports = mongoose.model("SystemMetric", systemMetricSchema);
