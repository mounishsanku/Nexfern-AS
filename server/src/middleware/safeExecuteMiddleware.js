const { runFullSystemDiagnostics } = require("../services/systemHealService");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

/**
 * Wraps async route handlers: on uncaught errors, runs quick full diagnostic + heal, then returns safe JSON.
 */
function safeExecute(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("CRITICAL ERROR:", err);
      const status = Number(err?.status || err?.statusCode);
      const clientErr = Number.isFinite(status) && status >= 400 && status < 500;
      if (!clientErr) {
        try {
          await runFullSystemDiagnostics({
            financialYearId: req.activeYear?._id ?? null,
            reason: "failed_transaction",
            silent: true,
            quick: true,
          });
        } catch (fixErr) {
          // eslint-disable-next-line no-console
          console.error("Post-failure diagnostic failed:", fixErr);
        }
      }
      if (res.headersSent) {
        return next(err);
      }
      if (clientErr) {
        return sendStructuredError(res, {
          status,
          code: err?.code && String(err.code) !== "Error" ? err.code : "REQUEST_FAILED",
          message: err.message || "Request could not be completed",
          action: ACTION.RETRY,
          recoveryAttempted: false,
        });
      }
      return sendStructuredError(res, {
        status: 503,
        code: "AUTO_RECOVERED",
        message: "A recovery step ran. Please retry the operation.",
        action: ACTION.RETRY,
        recoveryAttempted: true,
      });
    }
  };
}

module.exports = { safeExecute };
