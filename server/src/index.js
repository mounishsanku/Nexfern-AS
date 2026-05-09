require("dotenv").config();
const { validateEnv } = require("./config/envValidation");
try { validateEnv(); } catch (e) { process.stderr.write(e.message + "\n"); process.exit(1); }

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
const accessLoggingMiddleware = require("./middleware/accessLoggingMiddleware");
const accountRoutes = require("./routes/accountRoutes");
const openingBalanceRoutes = require("./routes/openingBalanceRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const revenueRoutes = require("./routes/revenueRoutes");
const tdsRoutes = require("./routes/tdsRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const revenueSourceRoutes = require("./routes/revenueSourceRoutes");
const eventRoutes = require("./routes/eventRoutes");
const systemDiagnosticsRoutes = require("./routes/systemDiagnosticsRoutes");
const localizationAdminRoutes = require("./routes/localizationAdminRoutes");
const importRoutes = require("./routes/importRoutes");
const reconciliationRoutes = require("./routes/reconciliationRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const gstRoutes = require("./routes/gstRoutes");
const { seedDefaultAccounts } = require("./controllers/accountController");
const { migrateVoucherEntries, migrateVoucherFinancialYear } = require("./migrations/migrateVoucherEntries");
const { migrateInvoiceNumbers } = require("./migrations/migrateInvoiceNumbers");
const { warmCache } = require("./services/accountService");
const { seedActiveYear } = require("./controllers/financialYearController");
const { runFullSystemDiagnostics } = require("./services/systemHealService");
const { sendStructuredError, ACTION } = require("./utils/httpErrorResponse");
const logger = require("./utils/logger");
const healthRoutes = require("./routes/healthRoutes");
const { markStartupComplete } = require("./routes/healthRoutes");
const { httpLatencyMiddleware } = require("./services/monitoringService");
const { authRateLimit, webhookRateLimit, importRateLimit, analyticsRateLimit } = require("./middleware/rateLimitMiddleware");
const { startBackgroundJobs } = require("./jobs/backgroundJobs");
const metricsRoutes = require("./routes/metricsRoutes");

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
app.use(httpLatencyMiddleware);
app.use(requestLogger);
app.use(accessLoggingMiddleware);
app.use(requireAccountingHealth);
app.use("/uploads", express.static(require("path").join(__dirname, "../uploads")));

// ── Health endpoints (no auth — load balancers + k8s call these) ──────────────
app.use("/health", healthRoutes);
// Legacy health shim
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", testRoutes);
app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/invoices", requireActiveYear, guardClosedYear, invoiceRoutes);
app.use("/api/expenses", requireActiveYear, guardClosedYear, expenseRoutes);
app.use("/api/payments", requireActiveYear, guardClosedYear, paymentRoutes);
app.use("/api/dashboard", requireActiveYear, guardClosedYear, dashboardRoutes);
app.use("/api/reports", requireActiveYear, guardClosedYear, reportsRoutes);
app.use("/api/customers", requireActiveYear, guardClosedYear, customerRoutes);
app.use("/api/trial-balance", requireActiveYear, guardClosedYear, trialBalanceRoutes);
app.use("/api/bank", requireActiveYear, guardClosedYear, bankRoutes);
app.use("/api/bank", requireActiveYear, guardClosedYear, bankReconciliation);
app.use("/api/audit", requireActiveYear, guardClosedYear, auditRoutes);
app.use("/api/financial-year", requireActiveYear, guardClosedYear, financialYearRoutes);
app.use("/api/vouchers", requireActiveYear, guardClosedYear, voucherRoutes);
app.use("/api/accounts", requireActiveYear, guardClosedYear, accountRoutes);
app.use("/api/opening-balances", requireActiveYear, guardClosedYear, openingBalanceRoutes);
app.use("/api/vendors", requireActiveYear, guardClosedYear, vendorRoutes);
app.use("/api/revenue", requireActiveYear, guardClosedYear, revenueRoutes);
app.use("/api/tds", requireActiveYear, guardClosedYear, tdsRoutes);
app.use("/api/payroll", requireActiveYear, guardClosedYear, payrollRoutes);
app.use("/api/revenue-sources", requireActiveYear, guardClosedYear, revenueSourceRoutes);
app.use("/api/events", requireActiveYear, guardClosedYear, eventRoutes);
app.use("/api/system", requireActiveYear, systemDiagnosticsRoutes);
app.use("/api/localization-admin", localizationAdminRoutes);
app.use("/api/import", requireActiveYear, guardClosedYear, importRateLimit, importRoutes);
app.use("/api/reconciliation", requireActiveYear, reconciliationRoutes);
app.use("/api/analytics", requireActiveYear, analyticsRateLimit, analyticsRoutes);
app.use("/api/gst", requireActiveYear, guardClosedYear, gstRoutes);
app.use("/api/metrics", metricsRoutes);

// Global error handler — must be last (never expose stack traces)
app.use((err, _req, res, _next) => {
  logger.error("Unhandled error", { code: err?.code, message: err?.message });
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
    // 1. Strictly enforce DB connection first
    await connectDb();

    // 2. Run initialization scripts only AFTER successful connection
    await seedDefaultAccounts();
    await seedActiveYear();
    await migrateVoucherEntries();
    await migrateVoucherFinancialYear();
    await migrateInvoiceNumbers();
    await warmCache();

    // 3. System Diagnostics (background jobs replace inline setInterval)
    try {
      const report = await runFullSystemDiagnostics({ reason: "startup" });
      logger.info("startup diagnostic", {
        issuesFound: report.issuesFound,
        issuesFixed: report.issuesFixed,
        systemStatus: report.systemStatus,
        remainingCount: report.remainingIssues?.length ?? 0,
      });
    } catch (healErr) {
      logger.warn("Startup full diagnostic failed", { error: healErr?.message });
    }

    // 4. Start all background jobs (replaces the inline setInterval)
    startBackgroundJobs();

    // 5. Start server — only after all initialization succeeded
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, { port: PORT, env: process.env.NODE_ENV || "development" });
      markStartupComplete();
    });

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    // On SIGTERM/SIGINT: stop accepting new connections, wait for in-flight
    // requests to complete (up to 10 s), then close DB and exit cleanly.
    let isShuttingDown = false;

    async function shutdown(signal) {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info(`graceful shutdown initiated`, { signal });

      // Stop accepting new TCP connections immediately
      server.close(async () => {
        try {
          await mongoose.connection.close();
          logger.info("graceful shutdown complete", { signal });
          process.exit(0);
        } catch (err) {
          logger.error("graceful shutdown: DB close failed", { error: err?.message });
          process.exit(1);
        }
      });

      // Force-kill if drain takes longer than 10 seconds
      setTimeout(() => {
        logger.error("graceful shutdown: timeout exceeded, forcing exit");
        process.exit(1);
      }, 10_000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));

    // Catch unhandled promise rejections — log and exit so the process
    // manager (PM2/k8s) can restart cleanly rather than running in a degraded state.
    process.on("unhandledRejection", (reason) => {
      logger.error("unhandledRejection", { reason: String(reason) });
      shutdown("unhandledRejection");
    });

  } catch (err) {
    logger.error("CRITICAL: Startup sequence failed. Shutting down.", { error: err?.message });
    process.exit(1);
  }
}

if (require.main === module && process.env.NODE_ENV !== "test") {
  start();
}

module.exports = app;