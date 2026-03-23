const FinancialYear = require("../models/FinancialYear");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

/**
 * requireActiveYear
 * -----------------
 * Reads `X-Financial-Year-Id` header.
 * If provided, loads and attaches req.activeYear.
 * If not provided, tries to find the single non-closed year automatically.
 * Proceeds without error if no year is configured (legacy mode).
 */
async function requireActiveYear(req, res, next) {
  try {
    const yearId = req.headers["x-financial-year-id"];
    let year = null;

    if (yearId) {
      year = await FinancialYear.findById(yearId).lean();
    } else {
      year = await FinancialYear.findOne({ isClosed: false })
        .sort({ startDate: -1 })
        .lean();
    }

    req.activeYear = year ?? null;
    return next();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("financialYearMiddleware error:", err);
    return next(); // non-fatal — proceed without year context
  }
}

/**
 * guardClosedYear
 * ---------------
 * Rejects mutating requests (POST/PUT/PATCH/DELETE) when the active year
 * is closed. Must be used after requireActiveYear.
 */
function guardClosedYear(req, res, next) {
  const mutating = ["POST", "PUT", "PATCH", "DELETE"];
  if (!mutating.includes(req.method)) return next();

  const year = req.activeYear;
  if (year && year.isClosed) {
    return sendStructuredError(res, {
      status: 403,
      code: "FY_LOCKED",
      message: "Financial year is closed",
      action: ACTION.FIX_REQUIRED,
    });
  }
  return next();
}

module.exports = { requireActiveYear, guardClosedYear };
