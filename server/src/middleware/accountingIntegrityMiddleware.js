const { runSystemValidation } = require("../services/systemValidationService");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

const TTL_MS = 60_000;
const SKIP_PREFIXES = ["/api/auth", "/api/system/validate", "/api/system/diagnostics", "/api/health", "/health"];

/** Error codes that must block mutating API when diagnostics reports them */
const BLOCKING_CODES = new Set([
  "VOUCHER_ENTRIES_UNBALANCED",
  "ORPHAN_VOUCHER_ENTRIES",
  "NON_APPROVED_EXPENSE_VOUCHERS",
  "BALANCE_SHEET_IMBALANCE",
  "NEGATIVE_CASH",
  "BANK_GL_MISMATCH",
  "ORPHAN_VOUCHERS",
  "INVALID_VOUCHERS",
  "VOUCHER_LINE_IMBALANCE",
]);

let cache = { at: 0, blocked: false, reasons: [] };

function pathFor(req) {
  const u = req.originalUrl || req.url || "";
  return u.split("?")[0] || "";
}

/**
 * When ENFORCE_ACCOUNTING_HEALTH=true, block POST/PUT/PATCH/DELETE if system validation reports critical issues.
 */
async function requireAccountingHealth(req, res, next) {
  if (String(process.env.ENFORCE_ACCOUNTING_HEALTH || "").toLowerCase() !== "true") {
    return next();
  }
  const method = String(req.method || "").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return next();
  }
  const p = pathFor(req);
  if (SKIP_PREFIXES.some((x) => p.startsWith(x))) {
    return next();
  }

  const now = Date.now();
  if (now - cache.at < TTL_MS) {
    if (cache.blocked) {
      return sendStructuredError(res, {
        status: 503,
        code: "SYSTEM_ACCOUNTING_BLOCKED",
        message:
          "Accounting integrity check failed. Fix critical issues (see GET /api/system/validate) before posting.",
        action: ACTION.FIX_REQUIRED,
        details: { reasons: cache.reasons },
      });
    }
    return next();
  }

  try {
    const r = await runSystemValidation();
    const critical = (r.errors || []).filter(
      (e) => e.severity === "critical" || BLOCKING_CODES.has(e.code),
    );
    cache = {
      at: now,
      blocked: critical.length > 0,
      reasons: critical.map((e) => ({ code: e.code, message: e.message })),
    };
  } catch (_e) {
    cache = { at: now, blocked: false, reasons: [] };
  }

  if (cache.blocked) {
    return sendStructuredError(res, {
      status: 503,
      code: "SYSTEM_ACCOUNTING_BLOCKED",
      message:
        "Accounting integrity check failed. Fix critical issues (see GET /api/system/validate) before posting.",
      action: ACTION.FIX_REQUIRED,
      details: { reasons: cache.reasons },
    });
  }
  return next();
}

module.exports = { requireAccountingHealth };
