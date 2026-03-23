const AuditLog = require("../models/AuditLog");
const { sendCsv } = require("../utils/csvExport");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

function parseYMD(dateStr) {
  if (typeof dateStr !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/audit or GET /api/audit/logs
 * Query: startDate, endDate, entityType
 */
async function getAuditLogs(req, res) {
  try {
    const { startDate, endDate, entityType } = req.query ?? {};

    const filter = {};

    const start = parseYMD(startDate);
    const end   = parseYMD(endDate);
    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = start;
      if (end) {
        filter.timestamp.$lte = new Date(Date.UTC(
          end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999
        ));
      }
    }

    if (entityType && typeof entityType === "string") {
      filter.entity = entityType.trim().toLowerCase();
    }

    const logs = await AuditLog.find(filter)
      .populate("userId", "name email")
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();

    const rows = logs.map((log) => ({
      _id:        log._id,
      userId:     log.userId?._id ?? log.userId,
      userName:   log.userId?.name ?? log.userId?.email ?? String(log.userId ?? "-"),
      action:     log.action,
      entityType: log.entity,
      entityId:   log.entityId,
      timestamp:  log.timestamp,
      metadata:   log.data ?? null,
    }));

    return res.json(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "AUDIT_LIST_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

/**
 * GET /api/audit/export — same filters as logs; CSV download (up to 10k rows).
 */
async function exportAuditCsv(req, res) {
  try {
    const { startDate, endDate, entityType } = req.query ?? {};

    const filter = {};

    const start = parseYMD(startDate);
    const end = parseYMD(endDate);
    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = start;
      if (end) {
        filter.timestamp.$lte = new Date(
          Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999),
        );
      }
    }

    if (entityType && typeof entityType === "string") {
      filter.entity = entityType.trim().toLowerCase();
    }

    const logs = await AuditLog.find(filter)
      .populate("userId", "name email")
      .sort({ timestamp: -1 })
      .limit(10000)
      .lean();

    const rows = [["Timestamp (UTC)", "User", "Email", "Action", "Entity", "Entity ID", "Metadata JSON"]];
    for (const log of logs) {
      const u = log.userId;
      const name = u?.name ?? "";
      const email = u?.email ?? "";
      rows.push([
        log.timestamp ? new Date(log.timestamp).toISOString() : "",
        name,
        email,
        log.action ?? "",
        log.entity ?? "",
        log.entityId != null ? String(log.entityId) : "",
        typeof log.data === "object" ? JSON.stringify(log.data) : String(log.data ?? ""),
      ]);
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    sendCsv(res, `audit-export-${stamp}.csv`, rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "AUDIT_EXPORT_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { getAuditLogs, exportAuditCsv };

