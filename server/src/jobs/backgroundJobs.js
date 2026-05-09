/**
 * backgroundJobs.js — Scheduled background task runner.
 *
 * Uses plain setInterval — no Redis/BullMQ dependency at this scale.
 * All jobs are:
 *  - Best-effort (failures are logged + alerted, never crash the server)
 *  - Auditable (create IncidentLog / SystemMetric entries)
 *  - Idempotent (safe to re-run)
 */
const logger = require("../utils/logger");
const { record } = require("../services/monitoringService");
const { alert } = require("../services/alertingService");
const { runAnalyticsDiagnostics, invalidateCache } = require("../services/analyticsEngine");
const { runReconciliationDiagnostics } = require("../services/reconciliationEngine");
const { runFullSystemDiagnostics } = require("../services/systemHealService");
const ReportCache = require("../models/ReportCache");

// ── Job Definitions ────────────────────────────────────────────────────────────

async function jobAnalyticsCacheRefresh() {
  const start = Date.now();
  try {
    // Invalidate stale caches so next request triggers a fresh compute
    const stale = await ReportCache.countDocuments({ status: "stale" });
    if (stale > 0) {
      await ReportCache.deleteMany({ status: "stale" });
      logger.info("backgroundJobs: purged stale report caches", { count: stale });
    }
    await record("job_cache_refresh_ms", Date.now() - start, { status: "ok" });
  } catch (err) {
    logger.error("backgroundJobs: cache refresh failed", { error: err?.message });
    await record("job_cache_refresh_ms", Date.now() - start, { status: "error" });
    await alert({ code: "JOB_CACHE_REFRESH_FAILED", message: err?.message, severity: "medium", source: "backgroundJobs" });
  }
}

async function jobStaleReconciliationCheck() {
  const start = Date.now();
  try {
    const { warnings } = await runReconciliationDiagnostics();
    if (warnings.length > 0) {
      for (const w of warnings) {
        logger.warn("backgroundJobs: reconciliation warning", { code: w.code, message: w.message });
      }
    }
    await record("job_reconciliation_check_ms", Date.now() - start, { warnings: warnings.length, status: "ok" });
  } catch (err) {
    logger.error("backgroundJobs: reconciliation check failed", { error: err?.message });
    await record("job_reconciliation_check_ms", Date.now() - start, { status: "error" });
  }
}

async function jobAnalyticsDiagnostics() {
  const start = Date.now();
  try {
    const { warnings } = await runAnalyticsDiagnostics();
    await record("job_analytics_diagnostics_ms", Date.now() - start, { warnings: warnings.length, status: "ok" });
  } catch (err) {
    logger.error("backgroundJobs: analytics diagnostics failed", { error: err?.message });
  }
}

async function jobSystemDiagnostics() {
  const start = Date.now();
  try {
    const report = await runFullSystemDiagnostics({ reason: "background_job", silent: true, quick: true });
    const remaining = report.remainingIssues?.length ?? 0;
    await record("job_system_diagnostics_ms", Date.now() - start, { remaining, status: report.systemStatus });
    if (remaining > 0) {
      await alert({
        code: "DIAGNOSTICS_BACKGROUND_ISSUES",
        message: `Background diagnostics: ${remaining} unresolved issue(s)`,
        severity: remaining > 5 ? "high" : "medium",
        source: "backgroundJobs",
        metadata: { remaining },
      });
    }
  } catch (err) {
    logger.error("backgroundJobs: system diagnostics failed", { error: err?.message });
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const INTERVALS = {
  cacheRefresh:         10 * 60 * 1000,  // every 10 min
  reconciliationCheck:  30 * 60 * 1000,  // every 30 min
  analyticsDiagnostics: 15 * 60 * 1000,  // every 15 min
  systemDiagnostics:     5 * 60 * 1000,  // every 5 min (mirrors existing interval)
};

let _started = false;

function startBackgroundJobs() {
  if (_started) return;
  _started = true;

  setInterval(() => jobAnalyticsCacheRefresh().catch(() => {}), INTERVALS.cacheRefresh);
  setInterval(() => jobStaleReconciliationCheck().catch(() => {}), INTERVALS.reconciliationCheck);
  setInterval(() => jobAnalyticsDiagnostics().catch(() => {}), INTERVALS.analyticsDiagnostics);

  // Note: system diagnostics interval is managed by index.js to avoid duplication.
  // This background job replaces the inline setInterval there.
  setInterval(() => jobSystemDiagnostics().catch(() => {}), INTERVALS.systemDiagnostics);

  logger.info("backgroundJobs: all scheduled jobs started", { intervals: INTERVALS });
}

module.exports = {
  startBackgroundJobs,
  jobAnalyticsCacheRefresh,
  jobStaleReconciliationCheck,
  jobAnalyticsDiagnostics,
  jobSystemDiagnostics,
};
