const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const { runFinanceDiagnostics } = require("../services/financeDiagnosticsService");
const { runSystemValidation } = require("../services/systemValidationService");
const { runFullSystemDiagnostics } = require("../services/systemHealService");
const { runRestoreTransactional, runRestoreNonTransactional } = require("../services/systemRestoreService");
const Voucher = require("../models/Voucher");
const VoucherEntry = require("../models/VoucherEntry");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const Account = require("../models/Account");
const OpeningBalance = require("../models/OpeningBalance");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const FinancialYear = require("../models/FinancialYear");

/**
 * GET /api/system/diagnostics
 * Query: ?fix=1 or ?applySafeFixes=true — only runs safe string trims on expenses (no voucher mutation).
 */
async function getSystemDiagnostics(req, res) {
  try {
    const q = String(req.query.fix ?? req.query.applySafeFixes ?? "").toLowerCase();
    const applySafeFixes = q === "1" || q === "true" || q === "yes";
    const result = await runFinanceDiagnostics({ applySafeFixes });
    return res.json(result);
  } catch (err) {
    console.error("getSystemDiagnostics error:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "DIAGNOSTICS_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

/**
 * GET /api/system/validate — accounting integrity (errors / warnings / metrics).
 */
async function getSystemValidate(req, res) {
  try {
    const result = await runSystemValidation();
    return res.json(result);
  } catch (err) {
    console.error("getSystemValidate error:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "VALIDATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

/**
 * GET /api/system/full-diagnostic — run detect → auto-fix → verify; returns structured report.
 */
async function getFullSystemDiagnostic(req, res) {
  try {
    const report = await runFullSystemDiagnostics({
      reason: "api_request",
      financialYearId: req.activeYear?._id ?? null,
    });
    return res.json(report);
  } catch (err) {
    console.error("getFullSystemDiagnostic error:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "FULL_DIAGNOSTIC_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

/**
 * POST /api/system/backup — JSON snapshot (admin). Version 2 includes dependencies for full restore.
 */
async function postBackup(req, res) {
  try {
    const [
      vouchers,
      voucherEntries,
      invoices,
      payments,
      expenses,
      accounts,
      openingBalances,
      customers,
      vendors,
      financialYears,
    ] = await Promise.all([
      Voucher.find().lean(),
      VoucherEntry.find().lean(),
      Invoice.find().lean(),
      Payment.find().lean(),
      Expense.find().lean(),
      Account.find().lean(),
      OpeningBalance.find().lean(),
      Customer.find().lean(),
      Vendor.find().lean(),
      FinancialYear.find().lean(),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
      financialYears,
      customers,
      vendors,
      accounts,
      openingBalances,
      invoices,
      payments,
      expenses,
      vouchers,
      voucherEntries,
    };

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `nexfern-backup-${stamp}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("postBackup error:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "BACKUP_FAILED",
      message: "Backup could not be generated",
      action: ACTION.RETRY,
    });
  }
}

/**
 * POST /api/system/restore
 * Body: { confirm: true, mode: "clear" | "merge", backup: { ... }, allowNonTransactional?: boolean }
 * Query: allowNonTransactional=1 — fallback when MongoDB transactions are unavailable.
 */
async function postRestore(req, res) {
  try {
    const confirm = req.body.confirm === true || String(req.body.confirm).toLowerCase() === "true";
    if (!confirm) {
      return res.status(400).json({
        message: 'Set confirm: true to run restore (destructive when mode is "clear").',
        code: "RESTORE_CONFIRM_REQUIRED",
      });
    }

    const mode = String(req.body.mode || "").toLowerCase();
    if (mode !== "clear" && mode !== "merge") {
      return res.status(400).json({
        message: 'mode must be "clear" or "merge"',
        code: "RESTORE_MODE_INVALID",
      });
    }

    const backup = req.body.backup;
    if (!backup || typeof backup !== "object") {
      return res.status(400).json({
        message: "backup must be the parsed JSON object from a Nexfern backup file",
        code: "RESTORE_BACKUP_REQUIRED",
      });
    }

    if (mode === "clear" && Number(backup.version || 1) < 2) {
      return res.status(400).json({
        message:
          'mode "clear" requires backup version 2+ (create a new backup from this server so financial years, customers, and vendors are included).',
        code: "RESTORE_CLEAR_REQUIRES_V2",
      });
    }

    const allowNt =
      String(req.query.allowNonTransactional || "") === "1" ||
      req.body.allowNonTransactional === true ||
      String(req.body.allowNonTransactional || "").toLowerCase() === "true";

    let result = await runRestoreTransactional(backup, mode);
    if (!result.ok && allowNt) {
      result = await runRestoreNonTransactional(backup, mode);
    }

    if (!result.ok) {
      return res.status(503).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("postRestore error:", err);
    return sendStructuredError(res, {
      status: 503,
      code: "RESTORE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
      details: err?.message ? { reason: String(err.message) } : undefined,
    });
  }
}

module.exports = {
  getSystemDiagnostics,
  getSystemValidate,
  getFullSystemDiagnostic,
  postBackup,
  postRestore,
};
