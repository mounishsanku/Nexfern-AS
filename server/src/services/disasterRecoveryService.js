/**
 * disasterRecoveryService.js — Backup verification and restore validation.
 *
 * SAFETY RULES:
 *  - Recovery simulation NEVER writes to production accounting models.
 *  - All operations are read-only or write to staging/temp contexts.
 *  - Integrity re-check after restore uses the existing diagnostics engine.
 */
const { encryptPayload, decryptPayload } = require("./encryptionService");
const { runFullSystemDiagnostics } = require("./systemHealService");
const IncidentLog = require("../models/IncidentLog");
const logger = require("../utils/logger");

/**
 * verifyBackup(encryptedPayload) — decrypts and validates a backup snapshot.
 * Returns { valid, issues[] }.
 */
async function verifyBackup(encryptedPayload) {
  const issues = [];
  try {
    if (!encryptedPayload?.encrypted || !encryptedPayload?.iv || !encryptedPayload?.encryptedData) {
      issues.push("Backup payload missing required AES-256-CBC fields (encrypted, iv, encryptedData).");
      return { valid: false, issues };
    }
    const data = decryptPayload(encryptedPayload);
    if (!data || typeof data !== "object") {
      issues.push("Decrypted backup payload is not a valid object.");
      return { valid: false, issues };
    }
    if (!data.version) issues.push("Backup missing version field.");
    if (!data.exportedAt) issues.push("Backup missing exportedAt field.");
    logger.info("disasterRecoveryService: backup verification passed", { version: data.version });
    return { valid: issues.length === 0, issues, metadata: { version: data.version, exportedAt: data.exportedAt } };
  } catch (err) {
    issues.push(`Decryption failed: ${err.message}`);
    await IncidentLog.create({
      severity: "critical", category: "backup_verification_failure",
      source: "disasterRecoveryService",
      message: `Backup verification failed: ${err.message}`,
    }).catch(() => {});
    return { valid: false, issues };
  }
}

/**
 * simulateRestore(encryptedPayload) — performs a dry-run restore without
 * touching production DB models. Returns { success, summary }.
 */
async function simulateRestore(encryptedPayload) {
  const { valid, issues, metadata } = await verifyBackup(encryptedPayload);
  if (!valid) return { success: false, issues };
  // Dry-run: in a real restore, this would replay into a staging DB.
  // Here we validate structure and report what would be restored.
  const data = decryptPayload(encryptedPayload);
  const summary = {};
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) summary[key] = val.length;
    else if (typeof val !== "object") summary[key] = val;
  }
  logger.info("disasterRecoveryService: restore simulation complete", summary);
  return { success: true, issues: [], summary, metadata };
}

/**
 * integrityCheckAfterRestore() — runs full diagnostics after a restore.
 * This is the mandatory step after any production restore.
 */
async function integrityCheckAfterRestore() {
  logger.audit("disasterRecoveryService: running post-restore integrity check");
  const report = await runFullSystemDiagnostics({ reason: "post_restore_integrity_check" });
  if (report.systemStatus !== "healthy") {
    await IncidentLog.create({
      severity: "critical", category: "post_restore_integrity_failure",
      source: "disasterRecoveryService",
      message: `Post-restore integrity check failed: ${report.remainingIssues?.length ?? 0} issue(s) remain.`,
      metadata: { systemStatus: report.systemStatus },
    }).catch(() => {});
  }
  return report;
}

module.exports = { verifyBackup, simulateRestore, integrityCheckAfterRestore };
