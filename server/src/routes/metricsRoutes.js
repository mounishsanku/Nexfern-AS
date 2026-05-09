/**
 * metricsRoutes.js — Operational metrics endpoint.
 *
 *  GET /metrics — returns uptime, DB state, memory usage, and recent HTTP metrics.
 *
 * Auth: Requires valid JWT. Never expose to public internet without auth.
 * Do NOT include PII, user data, or business records.
 */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { summary: metricSummary, cacheStats } = require("../services/monitoringService");
const logger = require("../utils/logger");

const DB_STATE = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

// GET /metrics — structured operational metrics (admin-only)
router.get("/", requireAuth, roleMiddleware(["admin", "accountant"]), async (_req, res) => {
  try {
    const mem = process.memoryUsage();
    const [metrics, cache] = await Promise.all([
      metricSummary(5 * 60 * 1000),   // last 5 minutes
      cacheStats(5 * 60 * 1000),
    ]);

    const dbState = mongoose.connection.readyState;
    const httpMetric = metrics.find((m) => m.metric === "http_latency");

    const payload = {
      ts: new Date().toISOString(),
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
      },
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
      },
      database: {
        state: DB_STATE[dbState] ?? "unknown",
        readyState: dbState,
        host: mongoose.connection.host ?? null,
        name: mongoose.connection.name ?? null,
      },
      http: {
        windowMinutes: 5,
        avgLatencyMs: httpMetric?.avg ?? null,
        maxLatencyMs: httpMetric?.max ?? null,
        requestCount: httpMetric?.count ?? null,
      },
      cache: cache,
    };

    logger.info("metrics: polled", { uptimeSeconds: payload.process.uptimeSeconds });
    return res.json(payload);
  } catch (err) {
    logger.error("metrics: failed", { error: err?.message });
    return res.status(503).json({ error: "Metrics unavailable", message: err?.message });
  }
});

module.exports = router;
