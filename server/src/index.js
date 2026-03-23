require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { connectDb } = require("./config/db");
const testRoutes = require("./routes/testRoutes");
const authRoutes = require("./routes/authRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const reportsRoutes = require("./routes/reportsRoutes");
const customerRoutes = require("./routes/customerRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const trialBalanceRoutes = require("./routes/trialBalanceRoutes");
const bankRoutes = require("./routes/bankRoutes");
const bankReconciliation = require("./routes/bankReconciliation");
const auditRoutes = require("./routes/auditRoutes");
const financialYearRoutes = require("./routes/financialYearRoutes");
const voucherRoutes = require("./routes/voucherRoutes");
const { requireActiveYear, guardClosedYear } = require("./middleware/financialYearMiddleware");
const { requireAccountingHealth } = require("./middleware/accountingIntegrityMiddleware");
const { requestLogger } = require("./middleware/requestLogger");
const accountRoutes = require("./routes/accountRoutes");
const openingBalanceRoutes = require("./routes/openingBalanceRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const revenueRoutes = require("./routes/revenueRoutes");
const tdsRoutes = require("./routes/tdsRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const revenueSourceRoutes = require("./routes/revenueSourceRoutes");
const eventRoutes = require("./routes/eventRoutes");
const systemDiagnosticsRoutes = require("./routes/systemDiagnosticsRoutes");
const { seedDefaultAccounts } = require("./controllers/accountController");
const { migrateVoucherEntries, migrateVoucherFinancialYear } = require("./migrations/migrateVoucherEntries");
const { migrateInvoiceNumbers } = require("./migrations/migrateInvoiceNumbers");
const { warmCache } = require("./services/accountService");
const { seedActiveYear } = require("./controllers/financialYearController");
const { runFullSystemDiagnostics } = require("./services/systemHealService");
const { sendStructuredError, ACTION } = require("./utils/httpErrorResponse");

const app = express();

// Reflect request Origin when CORS_ORIGINS unset — works with credentials (browser dev on localhost / 127.0.0.1 / LAN).
// Note: `origin: "*"` is incompatible with `credentials: true` per the Fetch spec.
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins?.length ? corsOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "32mb" }));
app.use(requestLogger);
app.use(requireAccountingHealth);
app.use("/uploads", express.static(require("path").join(__dirname, "../uploads")));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", testRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/invoices",       requireActiveYear, guardClosedYear, invoiceRoutes);
app.use("/api/expenses",       requireActiveYear, guardClosedYear, expenseRoutes);
app.use("/api/payments",       requireActiveYear, guardClosedYear, paymentRoutes);
app.use("/api/dashboard",      requireActiveYear, guardClosedYear, dashboardRoutes);
app.use("/api/reports",        requireActiveYear, guardClosedYear, reportsRoutes);
app.use("/api/customers",      requireActiveYear, guardClosedYear, customerRoutes);
app.use("/api/trial-balance",  requireActiveYear, guardClosedYear, trialBalanceRoutes);
app.use("/api/bank",           requireActiveYear, guardClosedYear, bankRoutes);
app.use("/api/bank",           requireActiveYear, guardClosedYear, bankReconciliation);
app.use("/api/audit",          requireActiveYear, guardClosedYear, auditRoutes);
app.use("/api/financial-year", requireActiveYear, guardClosedYear, financialYearRoutes);
app.use("/api/vouchers",       requireActiveYear, guardClosedYear, voucherRoutes);
app.use("/api/accounts",          requireActiveYear, guardClosedYear, accountRoutes);
app.use("/api/opening-balances",  requireActiveYear, guardClosedYear, openingBalanceRoutes);
app.use("/api/vendors",           requireActiveYear, guardClosedYear, vendorRoutes);
app.use("/api/revenue",           requireActiveYear, guardClosedYear, revenueRoutes);
app.use("/api/tds",               requireActiveYear, guardClosedYear, tdsRoutes);
app.use("/api/payroll",           requireActiveYear, guardClosedYear, payrollRoutes);
app.use("/api/revenue-sources",   requireActiveYear, guardClosedYear, revenueSourceRoutes);
app.use("/api/events",            requireActiveYear, guardClosedYear, eventRoutes);
app.use("/api/system",            requireActiveYear, systemDiagnosticsRoutes);

// Global error handler — must be last (never expose stack traces)
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  if (err?.code === "INSUFFICIENT_FUNDS") {
    return sendStructuredError(res, {
      status: err.status || 400,
      code: "INSUFFICIENT_FUNDS",
      message: err.message || "Insufficient funds",
      action: ACTION.RETRY,
    });
  }
  if (err?.code === "ALREADY_PROCESSED") {
    return sendStructuredError(res, {
      status: 409,
      code: "ALREADY_PROCESSED",
      message: err.message || "Already processed",
      action: ACTION.FIX_REQUIRED,
    });
  }
  if (err?.code === "FY_LOCKED") {
    return sendStructuredError(res, {
      status: err.status || 403,
      code: "FY_LOCKED",
      message: err.message || "Financial year is closed",
      action: ACTION.CONTACT_ADMIN,
    });
  }
  if (err?.code === "RECORD_IMMUTABLE") {
    return sendStructuredError(res, {
      status: err.status || 403,
      code: "RECORD_IMMUTABLE",
      message: err.message || "Record cannot be modified",
      action: ACTION.FIX_REQUIRED,
    });
  }
  if (err?.code === "BANK_GL_MISMATCH") {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: "BANK_GL_MISMATCH",
      message: err.message || "Operational bank balances do not match GL Cash+Bank",
      action: ACTION.RETRY,
      details: err.metrics,
    });
  }
  if (err?.code === "BANK_GL_BLOCK") {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: "BANK_GL_BLOCK",
      message: err.message || "GL and operational wallets are not aligned",
      action: ACTION.RETRY,
      details: err.metrics,
    });
  }
  if (
    err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
    err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET" ||
    err?.code === "ACCOUNTING_INVARIANT_NEGATIVE_BANK" ||
    err?.code === "ACCOUNTING_INVARIANT_FY"
  ) {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: err.code,
      message: err.message || "Accounting invariant violated",
      action: ACTION.CONTACT_ADMIN,
      details: err.metrics,
    });
  }
  if (err?.code === "SYSTEM_ACCOUNTING_BLOCKED") {
    return sendStructuredError(res, {
      status: 503,
      code: "SYSTEM_ACCOUNTING_BLOCKED",
      message: err.message || "System blocked due to accounting integrity",
      action: ACTION.CONTACT_ADMIN,
      details: err.reasons,
    });
  }
  if (err?.code === "SYSTEM_STATE_UNHEALABLE") {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: "SYSTEM_STATE_UNHEALABLE",
      message: err.message || "System state could not be repaired automatically",
      action: ACTION.CONTACT_ADMIN,
      details: err.metrics,
      recoveryAttempted: true,
    });
  }
  if (err?.code === "AUDIT_LOG_FAILED") {
    return sendStructuredError(res, {
      status: err.status || 503,
      code: "AUDIT_LOG_FAILED",
      message: "Audit log failed",
      action: ACTION.CONTACT_ADMIN,
      recoveryAttempted: false,
    });
  }
  const status = Number(err?.status || err?.statusCode) || 503;
  const code =
    err?.code && String(err.code) !== "Error" ? String(err.code) : "UNKNOWN_ERROR";
  const message =
    typeof err?.message === "string" && err.message.trim() && err.message !== "Error"
      ? err.message.trim()
      : "Something went wrong";
  return sendStructuredError(res, {
    status,
    code,
    message,
    action: ACTION.RETRY,
    recoveryAttempted: false,
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDb();
    await seedDefaultAccounts();
    await seedActiveYear();           // auto-create current FY if none exists
    await migrateVoucherEntries();    // backfill VoucherEntry.accountId
    await migrateVoucherFinancialYear(); // backfill Voucher.financialYearId
    await migrateInvoiceNumbers();
    await warmCache();
    try {
      const report = await runFullSystemDiagnostics({ reason: "startup" });
      // eslint-disable-next-line no-console
      console.log(
        "[Startup diagnostic]",
        JSON.stringify({
          issuesFound: report.issuesFound,
          issuesFixed: report.issuesFixed,
          systemStatus: report.systemStatus,
          remainingCount: report.remainingIssues?.length ?? 0,
        }),
      );
    } catch (healErr) {
      console.warn("Startup full diagnostic failed:", healErr?.message ?? healErr);
    }

    const DIAG_INTERVAL_MS = 5 * 60 * 1000;
    setInterval(async () => {
      try {
        await runFullSystemDiagnostics({ reason: "interval", silent: true, quick: true });
      } catch (e) {
        console.warn("Scheduled diagnostic failed:", e?.message ?? e);
      }
    }, DIAG_INTERVAL_MS);
  } catch (err) {
    console.warn(
      "MongoDB not connected (set MONGODB_URI to enable):",
      err?.message ?? err
    );
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
