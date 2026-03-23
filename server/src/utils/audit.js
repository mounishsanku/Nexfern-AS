const AuditLog = require("../models/AuditLog");

/** Standardized actions — use only these for new logs */
const ACTIONS = Object.freeze({
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  APPROVE: "APPROVE",
  LOGIN: "LOGIN",
  REVERSE: "REVERSE",
});

/**
 * Build metadata with before/after structure
 * @param {object|null} before — state before change (null for CREATE)
 * @param {object|null} after  — state after change (null for DELETE)
 */
function buildMetadata(before = null, after = null) {
  return { before: before ?? null, after: after ?? null };
}

/**
 * logAction — core audit logger (best-effort, never throws)
 * @param {string|ObjectId} userId
 * @param {string} action — CREATE | UPDATE | DELETE | LOGIN
 * @param {string} entityType — invoice, payment, expense, voucher, auth, etc.
 * @param {string|ObjectId} entityId
 * @param {object} metadata — { before, after } or legacy format (preserved)
 */
async function logAction(userId, action, entityType, entityId, metadata = null) {
  if (!userId) return null;

  const before = metadata?.before ?? null;
  const after = metadata?.after ?? null;

  try {
    return await AuditLog.create({
      userId,
      action,
      entity: entityType,
      entityId: entityId ? String(entityId) : "",
      before,
      after,
      data: metadata ?? null,
      timestamp: new Date(),
    });
  } catch (err) {
    if (String(process.env.AUDIT_STRICT || "").toLowerCase() === "true") {
      const e = new Error("Audit log failed");
      e.code = "AUDIT_LOG_FAILED";
      e.status = 500;
      e.cause = err;
      throw e;
    }
    return null;
  }
}

/**
 * logActionFromReq — extracts userId from req and logs
 */
async function logActionFromReq(req, action, entityType, entityId, metadata = null) {
  const userId = req.user?.sub ?? req.user?.id ?? null;
  return logAction(userId, action, entityType, entityId, metadata);
}

module.exports = { logAction, logActionFromReq, buildMetadata, ACTIONS };

