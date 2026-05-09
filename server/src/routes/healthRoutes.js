/**
 * healthRoutes.js — Kubernetes/load-balancer compatible health endpoints.
 *
 *  GET /health/live    — liveness: is the process alive?
 *  GET /health/ready   — readiness: is the service ready to serve traffic?
 *  GET /health/startup — startup: did initialization complete?
 *
 * No auth required — load balancers + container orchestrators call these.
 * NEVER expose sensitive data in health responses.
 */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ReportCache = require("../models/ReportCache");
const WebhookEvent = require("../models/WebhookEvent");
const { summary: metricSummary } = require("../services/monitoringService");
const logger = require("../utils/logger");

let startupComplete = false;
let startupTime = null;

/** Called by index.js once the full startup sequence is done. */
function markStartupComplete() {
  startupComplete = true;
  startupTime = new Date().toISOString();
}

// GET /health/live — liveness probe (fast, no DB call)
router.get("/live", (_req, res) => {
  res.json({ status: "alive", pid: process.pid, uptime: Math.floor(process.uptime()) });
});

// GET /health/startup — startup probe
router.get("/startup", (_req, res) => {
  if (!startupComplete) {
    return res.status(503).json({ status: "starting", message: "Startup sequence not yet complete." });
  }
  res.json({ status: "started", startupTime });
});

// GET /health/ready — readiness probe (checks all subsystems)
router.get("/ready", async (_req, res) => {
  const checks = {};
  let overallOk = true;

  // 1. MongoDB
  try {
    const state = mongoose.connection.readyState;
    // 1 = connected
    checks.mongo = state === 1 ? "ok" : "degraded";
    if (state !== 1) overallOk = false;
  } catch {
    checks.mongo = "error";
    overallOk = false;
  }

  // 2. Cache subsystem
  try {
    const staleCount = await ReportCache.countDocuments({ status: "stale" });
    checks.reportCache = staleCount > 10 ? "degraded" : "ok";
    checks.staleCaches = staleCount;
  } catch {
    checks.reportCache = "error";
    overallOk = false;
  }

  // 3. Webhook subsystem (recent failure rate)
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const failures = await WebhookEvent.countDocuments({ status: "failed", createdAt: { $gte: since } });
    checks.webhooks = failures > 5 ? "degraded" : "ok";
    checks.recentWebhookFailures = failures;
  } catch {
    checks.webhooks = "unknown";
  }

  // 4. Memory pressure
  const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  checks.memoryMb = memMb;
  checks.memory = memMb > 512 ? "degraded" : "ok";

  // 5. Monitoring metrics (last 5 min)
  try {
    const metrics = await metricSummary(5 * 60 * 1000);
    const httpMetric = metrics.find((m) => m.metric === "http_latency");
    checks.avgLatencyMs = httpMetric?.avg ?? null;
    checks.monitoring = "ok";
  } catch {
    checks.monitoring = "degraded";
  }

  const status = overallOk ? "ready" : "degraded";
  logger.info("healthcheck", { status, ...checks });
  res.status(overallOk ? 200 : 503).json({ status, checks });
});

module.exports = router;
module.exports.markStartupComplete = markStartupComplete;
