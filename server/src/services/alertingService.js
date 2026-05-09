/**
 * alertingService.js — Operational alerting foundation.
 *
 * Current outputs: IncidentLog (DB) + structured logger (stderr).
 * Future-ready: Slack/email/webhook outputs via provider pattern.
 *
 * SAFETY: All alert() calls are best-effort — never block accounting operations.
 */
const IncidentLog = require("../models/IncidentLog");
const logger = require("../utils/logger");

const SEVERITY = { low: "low", medium: "medium", high: "high", critical: "critical" };

/**
 * alert() — record an operational alert. Best-effort, never throws.
 * @param {object} params
 * @param {string} params.code       — machine-readable alert code
 * @param {string} params.message    — human-readable description
 * @param {"low"|"medium"|"high"|"critical"} params.severity
 * @param {string} params.source     — service/component name
 * @param {object} params.metadata   — additional context (never include secrets)
 */
async function alert({ code, message, severity = "medium", source = "system", metadata = {} }) {
  try {
    logger.warn(`[ALERT:${severity.toUpperCase()}] ${code}: ${message}`, { source, ...metadata });
    await IncidentLog.create({
      severity,
      category: code,
      source,
      message,
      metadata,
    });
  } catch (err) {
    // Best-effort: log to stderr but do NOT re-throw
    logger.error("alertingService: failed to persist alert", { code, error: err?.message });
  }
}

// ── Prebuilt alert helpers ─────────────────────────────────────────────────────

async function webhookFailureAlert(provider, reason, count = 1) {
  if (count < 3) return; // Only alert after 3 consecutive failures
  return alert({
    code: "WEBHOOK_REPEATED_FAILURE",
    message: `Webhook provider "${provider}" has failed ${count} times: ${reason}`,
    severity: count >= 10 ? SEVERITY.critical : SEVERITY.high,
    source: "webhookService",
    metadata: { provider, failureCount: count },
  });
}

async function reconciliationAnomalyAlert(sessionId, discrepancyCount, total) {
  return alert({
    code: "RECONCILIATION_ANOMALY",
    message: `Reconciliation session ${sessionId}: ${discrepancyCount}/${total} unmatched (>${Math.round((discrepancyCount / total) * 100)}%)`,
    severity: discrepancyCount / total > 0.5 ? SEVERITY.high : SEVERITY.medium,
    source: "reconciliationEngine",
    metadata: { sessionId, discrepancyCount, total },
  });
}

async function backupFailureAlert(reason) {
  return alert({
    code: "BACKUP_FAILURE",
    message: `Encrypted backup failed: ${reason}`,
    severity: SEVERITY.critical,
    source: "backupEncryptionService",
    metadata: {},
  });
}

async function highErrorRateAlert(route, errorCount, windowMs) {
  return alert({
    code: "HIGH_ERROR_RATE",
    message: `Route ${route} has ${errorCount} errors in ${windowMs / 1000}s window`,
    severity: SEVERITY.high,
    source: "monitoringService",
    metadata: { route, errorCount, windowMs },
  });
}

async function diagnosticsDriftAlert(issueCount) {
  return alert({
    code: "DIAGNOSTICS_DRIFT",
    message: `System diagnostics detected ${issueCount} unresolved issue(s) after auto-heal attempt`,
    severity: issueCount > 5 ? SEVERITY.critical : SEVERITY.high,
    source: "systemHealService",
    metadata: { issueCount },
  });
}

module.exports = {
  alert,
  SEVERITY,
  webhookFailureAlert,
  reconciliationAnomalyAlert,
  backupFailureAlert,
  highErrorRateAlert,
  diagnosticsDriftAlert,
};
