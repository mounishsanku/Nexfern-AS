/**
 * Global error standard — every client error body: { code, message, action, details? }.
 * Never use the strings "server error" / "internal error" in responses.
 */

const ACTION = {
  RETRY: "RETRY",
  CONTACT_ADMIN: "CONTACT_ADMIN",
  FIX_REQUIRED: "FIX_REQUIRED",
};

/**
 * @param {import("express").Response} res
 * @param {{
 *   status?: number,
 *   code: string,
 *   message: string,
 *   action?: string,
 *   details?: unknown,
 *   [k: string]: unknown
 * }} opts
 */
function sendStructuredError(res, opts) {
  const {
    status = 503,
    code = "UNKNOWN_ERROR",
    message = "Something went wrong",
    action = ACTION.RETRY,
    details,
    ...rest
  } = opts || {};
  const body = {
    code,
    message,
    action: action || ACTION.RETRY,
    ...rest,
  };
  if (details !== undefined) {
    body.details = details;
  }
  return res.status(status).json(body);
}

function mapErrorToCode(err) {
  if (!err) return null;
  if (err.name === "ValidationError") return "VALIDATION_ERROR";
  if (err.code === 11000 || err.code === "11000") return "DB_OPERATION_FAILED";
  const c = err.code;
  if (c && typeof c === "string" && c !== "Error") return c;
  return null;
}

function userSafeMessage(err, fallback = "Something went wrong") {
  const raw = err?.message;
  if (typeof raw === "string" && raw.trim() && raw !== "Error") {
    return raw.trim();
  }
  return fallback;
}

/**
 * Catch-all for controller catch blocks — logs server-side, structured response to client.
 * @param {import("express").Response} res
 * @param {unknown} err
 * @param {{ code?: string, status?: number, action?: string, details?: unknown, message?: string }} [options]
 */
function sendInternalError(res, err, options = {}) {
  // eslint-disable-next-line no-console
  console.error("[sendInternalError]", options.code || mapErrorToCode(err) || "unknown", err);

  if (err?.code === "SYSTEM_STATE_UNHEALABLE") {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: "SYSTEM_STATE_UNHEALABLE",
      message: userSafeMessage(
        err,
        "System state could not be repaired automatically. Run diagnostics or contact support.",
      ),
      action: ACTION.CONTACT_ADMIN,
      details: err.metrics,
      recoveryAttempted: true,
    });
  }

  const {
    code: explicitCode,
    status = 503,
    action = ACTION.RETRY,
    details,
    message: explicitMessage,
    recoveryAttempted = false,
    ...extra
  } = options;

  const code = explicitCode || mapErrorToCode(err) || "UNKNOWN_ERROR";
  const message =
    explicitMessage ||
    userSafeMessage(err, "Something went wrong");

  return sendStructuredError(res, {
    status,
    code,
    message,
    action,
    details,
    recoveryAttempted,
    ...extra,
  });
}

/** Client validation / bad input — 400 with FIX_REQUIRED. */
function sendValidationError(res, message, code = "VALIDATION_ERROR") {
  return sendStructuredError(res, {
    status: 400,
    code,
    message,
    action: ACTION.FIX_REQUIRED,
  });
}

module.exports = {
  sendStructuredError,
  sendInternalError,
  sendValidationError,
  ACTION,
  mapErrorToCode,
};
