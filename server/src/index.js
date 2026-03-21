require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { connectDb } = require("./config/db");
const testRoutes = require("./routes/testRoutes");
const authRoutes = require("./routes/authRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const expenseUploadRoute = require("./routes/expenseUploadRoute");
const dashboardRoutes = require("./routes/dashboardRoutes");
const reportsRoutes = require("./routes/reportsRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const customerRoutes = require("./routes/customerRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const trialBalanceRoutes = require("./routes/trialBalanceRoutes");
const bankRoutes = require("./routes/bankRoutes");
const bankReconciliation = require("./routes/bankReconciliation");
const auditRoutes = require("./routes/auditRoutes");
const financialYearRoutes = require("./routes/financialYearRoutes");
const voucherRoutes = require("./routes/voucherRoutes");
const { requireActiveYear, guardClosedYear } = require("./middleware/financialYearMiddleware");
const accountRoutes = require("./routes/accountRoutes");
const openingBalanceRoutes = require("./routes/openingBalanceRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const { seedDefaultAccounts } = require("./controllers/accountController");
const { migrateVoucherEntries, migrateVoucherFinancialYear } = require("./migrations/migrateVoucherEntries");
const { warmCache } = require("./services/accountService");
const { seedActiveYear } = require("./controllers/financialYearController");

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(require("path").join(__dirname, "../uploads")));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", testRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/expenses",       expenseUploadRoute); // upload — no FY guard needed
app.use("/api/invoices",       requireActiveYear, guardClosedYear, invoiceRoutes);
app.use("/api/expenses",       requireActiveYear, guardClosedYear, expenseRoutes);
app.use("/api/payments",       requireActiveYear, guardClosedYear, paymentRoutes);
app.use("/api/dashboard",      dashboardRoutes);
app.use("/api/reports",        reportsRoutes);
app.use("/api/ledger",         ledgerRoutes);
app.use("/api/customers",      customerRoutes);
app.use("/api/trial-balance",  trialBalanceRoutes);
app.use("/api/bank",           bankRoutes);
app.use("/api/bank",           bankReconciliation);
app.use("/api/audit",          auditRoutes);
app.use("/api/financial-year", financialYearRoutes);
app.use("/api/vouchers",       voucherRoutes);
app.use("/api/accounts",          accountRoutes);
app.use("/api/opening-balances",  openingBalanceRoutes);
app.use("/api/vendors",           vendorRoutes);

// Global error handler — must be last
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({ message: err?.message ?? "Internal server error" });
});

const PORT = 5000;

async function start() {
  try {
    await connectDb();
    await seedDefaultAccounts();
    await seedActiveYear();           // auto-create current FY if none exists
    await migrateVoucherEntries();    // backfill VoucherEntry.accountId
    await migrateVoucherFinancialYear(); // backfill Voucher.financialYearId
    await warmCache();
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
