const {
  runFullSystemDiagnostics,
  validateSystemState,
} = require("../services/systemHealService");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

/**
 * Runs quick diagnostics + heal, then blocks writes if validation still fails
 * or operational state (GL/bank, cash, orphans) is inconsistent.
 */
async function preTransactionGuard(req, res, next) {
  try {
    const financialYearId = req.activeYear?._id ?? null;
    const result = await runFullSystemDiagnostics({
      silent: true,
      quick: true,
      financialYearId,
      reason: "pre_transaction_guard",
    });

    if (result.systemStatus !== "STABLE") {
      return sendStructuredError(res, {
        status: 409,
        code: "SYSTEM_NOT_READY",
        message: "System not stable. Auto-fix required.",
        action: ACTION.RETRY,
        details: { issues: result.remainingIssues },
      });
    }

    const state = await validateSystemState(financialYearId);
    if (!state.ok) {
      return sendStructuredError(res, {
        status: 409,
        code: "SYSTEM_INCONSISTENT",
        message: "Accounting state is inconsistent. Transaction blocked.",
        action: ACTION.CONTACT_ADMIN,
        details: { issues: state.issues, metrics: state.diff },
      });
    }

    return next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("preTransactionGuard:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "PRECHECK_FAILED",
      message: "Pre-check failed. Try again shortly.",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { preTransactionGuard };
