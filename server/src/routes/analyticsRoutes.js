/**
 * analyticsRoutes.js — REST API for the Analytics Engine.
 * Admin + Accountant. All data derives from authoritative accounting sources.
 */
const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const {
  generateKPISummary,
  generatePnLTrend,
  computeReceivablesAging,
  computePayablesAging,
  computeReconciliationMetrics,
  invalidateCache,
  runAnalyticsDiagnostics,
} = require("../services/analyticsEngine");
const ReportCache = require("../models/ReportCache");

router.use(requireAuth);
router.use(roleMiddleware("admin", "accountant"));

// GET /api/analytics/kpi — executive KPI summary (cached)
router.get("/kpi", async (req, res) => {
  try {
    const { entityId, useCache = "true", ...filters } = req.query;
    const data = await generateKPISummary(filters, entityId, { useCache: useCache !== "false" });
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_KPI_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/trend — P&L trend for last N months
router.get("/trend", async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months || "6")));
    const data = await generatePnLTrend(months);
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_TREND_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/receivables — receivables aging
router.get("/receivables", async (req, res) => {
  try {
    const data = await computeReceivablesAging();
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_RECV_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/payables — payables aging
router.get("/payables", async (req, res) => {
  try {
    const data = await computePayablesAging();
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_PAYABLES_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/reconciliation — reconciliation efficiency metrics
router.get("/reconciliation", async (req, res) => {
  try {
    const data = await computeReconciliationMetrics();
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_RECON_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/cache — list cache records (admin only)
router.get("/cache", roleMiddleware("admin"), async (req, res) => {
  try {
    const caches = await ReportCache.find().select("-payload").sort({ generatedAt: -1 }).limit(50).lean();
    res.json(caches);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_CACHE_LIST_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// DELETE /api/analytics/cache/:reportType — invalidate a specific cache
router.delete("/cache/:reportType", roleMiddleware("admin"), async (req, res) => {
  try {
    const { entityId } = req.query;
    await invalidateCache(req.params.reportType, entityId);
    res.json({ message: `Cache invalidated for ${req.params.reportType}` });
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_CACHE_INVALIDATE_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

// GET /api/analytics/diagnostics — report/cache health
router.get("/diagnostics", async (req, res) => {
  try {
    const data = await runAnalyticsDiagnostics();
    res.json(data);
  } catch (err) {
    return sendStructuredError(res, { status: 503, code: "ANALYTICS_DIAG_FAILED", message: err.message, action: ACTION.RETRY });
  }
});

module.exports = router;
