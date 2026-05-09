/**
 * backupEncryptionService.js — backward-compatibility shim.
 * All actual logic now lives in encryptionService.js.
 * Existing callers continue to work unchanged.
 */
const IncidentLog = require("../models/IncidentLog");
const { encryptPayload, decryptPayload } = require("./encryptionService");

const encryptBackupPayload = encryptPayload;

async function decryptBackupPayload(envelope, userId = null) {
  try {
    return decryptPayload(envelope);
  } catch (err) {
    await IncidentLog.create({
      severity: "critical",
      category: "backup_decrypt_failure",
      source: "backupEncryptionService",
      message: "Failed to decrypt backup. Incorrect key or corrupted payload.",
      metadata: { error: err.message },
    }).catch(() => {});
    throw new Error("Failed to decrypt backup payload");
  }
}

module.exports = { encryptBackupPayload, decryptBackupPayload };
