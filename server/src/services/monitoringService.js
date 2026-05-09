/**
 * monitoringService.js — Operational metrics collection.
 *
 * SAFETY: All record() calls are best-effort (never throw, never block requests).
 * Metrics are tagged with labels for filtering (route, provider, reportType, etc.).
 */
const SystemMetric = require("../models/SystemMetric");
const logger = require("../utils/logger");

/**
 * record() — best-effort metric write. Never throws.
 */
async function record(metricType, value, labels = {}) {
  try {
    await SystemMetric.create({ metricType, value, labels, timestamp: new Date() });
  } catch (err) {
    logger.warn("monitoringService: failed to record metric", { metricType, error: err?.message });
  }
}

/**
 * time() — wraps an async function and records its duration as a metric.
 * Returns the result of fn. Never swallows fn errors.
 */
async function time(metricType, fn, labels = {}) {
  const start = Date.now();
  try {
    const result = await fn();
    await record(metricType, Date.now() - start, { ...labels, status: "ok" });
    return result;
  } catch (err) {
    await record(metricType, Date.now() - start, { ...labels, status: "error" });
    throw err;
  }
}

/**
 * summary() — aggregate metrics for the ops dashboard.
 */
async function summary(windowMs = 60 * 60 * 1000) {
  const since = new Date(Date.now() - windowMs);
  const agg = await SystemMetric.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: "$metricType",
        count: { $sum: 1 },
        avg: { $avg: "$value" },
        max: { $max: "$value" },
        min: { $min: "$value" },
      },
    },
  ]);
  return agg.map((r) => ({
    metric: r._id,
    count: r.count,
    avg: Math.round(r.avg),
    max: r.max,
    min: r.min,
  }));
}

/**
 * cacheStats() — ratio of cache hits vs misses in the window.
 */
async function cacheStats(windowMs = 60 * 60 * 1000) {
  const since = new Date(Date.now() - windowMs);
  const [hits, misses] = await Promise.all([
    SystemMetric.countDocuments({ metricType: "cache_hit", timestamp: { $gte: since } }),
    SystemMetric.countDocuments({ metricType: "cache_miss", timestamp: { $gte: since } }),
  ]);
  const total = hits + misses;
  return { hits, misses, total, hitRate: total > 0 ? Math.round((hits / total) * 100) : null };
}

/**
 * HTTP latency middleware — attaches to express app.
 */
function httpLatencyMiddleware(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    record("http_latency", ms, {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    }).catch(() => {});
  });
  next();
}

module.exports = { record, time, summary, cacheStats, httpLatencyMiddleware };
