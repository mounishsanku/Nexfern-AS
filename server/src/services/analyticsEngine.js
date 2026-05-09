/**
 * analyticsEngine.js — Enterprise KPI and analytics computation.
 *
 * CRITICAL DESIGN RULE:
 *  All financial totals MUST be derived from reportController's trusted accounting
 *  functions (buildAccountMap, resolveFilter, getProfitLoss). This engine never
 *  duplicates accounting math — it orchestrates and enriches existing data only.
 *
 * Architecture:
 *  analyticsEngine
 *    → resolveFilter         (reportController — authoritative voucher scope)
 *    → buildAccountMap       (reportController — authoritative account totals)
 *    → Invoice / Payment     (operational models for aging, AR/AP)
 *    → ReconciliationMatch   (reconciliation efficiency metrics)
 *    → ReportCache           (optional caching layer)
 */

const { resolveFilter, buildAccountMap, round } = require("../controllers/reportController");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const BankTransaction = require("../models/BankTransaction");
const ReconciliationMatch = require("../models/ReconciliationMatch");
const FinancialYear = require("../models/FinancialYear");
const ReportCache = require("../models/ReportCache");
const { hashFilters } = require("../models/ReportCache");
const IncidentLog = require("../models/IncidentLog");

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ── Cache Helpers ─────────────────────────────────────────────────────────────

async function getCached(reportType, filters, entityId) {
  const fHash = hashFilters(filters);
  return ReportCache.findOne({
    reportType,
    filtersHash: fHash,
    entityId: entityId || null,
    status: "fresh",
    expiresAt: { $gt: new Date() },
  }).lean();
}

async function upsertCache(reportType, filters, entityId, payload, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const fHash = hashFilters(filters);
  const expiresAt = new Date(Date.now() + ttlMs);
  return ReportCache.findOneAndUpdate(
    { reportType, filtersHash: fHash, entityId: entityId || null },
    { $set: { payload, generatedAt: new Date(), expiresAt, status: "fresh", metadata: { filters } } },
    { upsert: true, returnDocument: "after" }
  );
}

async function invalidateCache(reportType, entityId = null) {
  return ReportCache.updateMany(
    { reportType, entityId: entityId || null },
    { $set: { status: "stale" } }
  );
}

// ── P&L Derivation (authoritative source) ────────────────────────────────────

async function derivePnL(filters = {}) {
  const { voucherIds, financialYearId } = await resolveFilter(filters);
  const map = await buildAccountMap(voucherIds, financialYearId);
  let revenue = 0, expenses = 0;
  for (const row of map.values()) {
    if (row.type === "revenue") revenue += row.credit - row.debit;
    if (row.type === "expense") expenses += row.debit - row.credit;
  }
  return { revenue: round(revenue), expenses: round(expenses), profit: round(revenue - expenses) };
}

async function deriveCashPosition(filters = {}) {
  const { voucherIds, financialYearId } = await resolveFilter(filters);
  const map = await buildAccountMap(voucherIds, financialYearId);
  let cash = 0, bank = 0;
  for (const row of map.values()) {
    const name = String(row.account || "").toLowerCase();
    if (row.type === "asset") {
      if (name === "cash") cash = row.balance;
      else if (name.includes("bank")) bank += row.balance;
    }
  }
  return { cash: round(cash), bank: round(bank), total: round(cash + bank) };
}

// ── Receivables Aging ─────────────────────────────────────────────────────────

async function computeReceivablesAging() {
  const now = new Date();
  const invoices = await Invoice.find({
    status: { $in: ["sent", "partial", "overdue"] },
    dueDate: { $exists: true },
  }).select("invoiceNumber totalAmount paidAmount dueDate customerName").lean();

  const buckets = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
  const detail = [];

  for (const inv of invoices) {
    const outstanding = (inv.totalAmount || 0) - (inv.paidAmount || 0);
    if (outstanding <= 0) continue;
    const ageDays = Math.floor((now - new Date(inv.dueDate)) / 86400000);
    let bucket;
    if (ageDays <= 0) bucket = "current";
    else if (ageDays <= 30) bucket = "1_30";
    else if (ageDays <= 60) bucket = "31_60";
    else if (ageDays <= 90) bucket = "61_90";
    else bucket = "over_90";
    buckets[bucket] += outstanding;
    detail.push({ invoiceNumber: inv.invoiceNumber, customer: inv.customerName, outstanding: round(outstanding), ageDays, bucket });
  }

  for (const k of Object.keys(buckets)) buckets[k] = round(buckets[k]);
  return { buckets, total: round(Object.values(buckets).reduce((a, b) => a + b, 0)), detail };
}

// ── Payables Aging ────────────────────────────────────────────────────────────

async function computePayablesAging() {
  const now = new Date();
  const expenses = await Expense.find({
    status: "approved",
    paidAt: null,
  }).select("title amount vendor date").lean();

  const buckets = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
  for (const exp of expenses) {
    const ageDays = Math.floor((now - new Date(exp.date || exp.createdAt)) / 86400000);
    let bucket;
    if (ageDays <= 0) bucket = "current";
    else if (ageDays <= 30) bucket = "1_30";
    else if (ageDays <= 60) bucket = "31_60";
    else if (ageDays <= 90) bucket = "61_90";
    else bucket = "over_90";
    buckets[bucket] += exp.amount || 0;
  }
  for (const k of Object.keys(buckets)) buckets[k] = round(buckets[k]);
  return { buckets, total: round(Object.values(buckets).reduce((a, b) => a + b, 0)) };
}

// ── Reconciliation Efficiency ─────────────────────────────────────────────────

async function computeReconciliationMetrics() {
  const [total, confirmed, reversed, pending] = await Promise.all([
    ReconciliationMatch.countDocuments({}),
    ReconciliationMatch.countDocuments({ status: "confirmed" }),
    ReconciliationMatch.countDocuments({ status: "reversed" }),
    BankTransaction.countDocuments({ isReconciled: { $ne: true } }),
  ]);
  const efficiency = total > 0 ? round((confirmed / total) * 100) : 0;
  return { total, confirmed, reversed, pendingTransactions: pending, efficiency };
}

// ── KPI Summary ───────────────────────────────────────────────────────────────

/**
 * generateKPISummary — primary analytics entry point.
 * Derives all KPIs from authoritative accounting sources.
 * Optionally reads from/writes to ReportCache.
 */
async function generateKPISummary(filters = {}, entityId = null, { useCache = true } = {}) {
  const cacheKey = "kpi_summary";

  if (useCache) {
    const cached = await getCached(cacheKey, filters, entityId);
    if (cached) return { ...cached.payload, _cached: true, cachedAt: cached.generatedAt };
  }

  const [pnl, cashPosition, receivables, payables, reconMetrics] = await Promise.all([
    derivePnL(filters),
    deriveCashPosition(filters),
    computeReceivablesAging(),
    computePayablesAging(),
    computeReconciliationMetrics(),
  ]);

  const grossMargin = pnl.revenue > 0 ? round(((pnl.revenue - pnl.expenses) / pnl.revenue) * 100) : 0;
  const cashRunwayMonths = pnl.expenses > 0
    ? round((cashPosition.total / (pnl.expenses / 12)) * 10) / 10
    : null;

  const kpis = {
    revenue: pnl.revenue,
    expenses: pnl.expenses,
    profit: pnl.profit,
    grossMargin,
    cashPosition: cashPosition.total,
    cashBreakdown: cashPosition,
    receivablesTotal: receivables.total,
    receivablesBuckets: receivables.buckets,
    payablesTotal: payables.total,
    payablesBuckets: payables.buckets,
    cashRunwayMonths,
    reconciliation: reconMetrics,
    generatedAt: new Date().toISOString(),
    _cached: false,
  };

  if (useCache) {
    await upsertCache(cacheKey, filters, entityId, kpis).catch(() => {});
  }

  return kpis;
}

// ── Trend Analysis ────────────────────────────────────────────────────────────

/**
 * Generates month-by-month P&L trend for the last N months.
 * Each data point derives from authoritative reportController sources.
 */
async function generatePnLTrend(months = 6) {
  const trend = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    try {
      const data = await derivePnL({ startDate: start.toISOString(), endDate: end.toISOString() });
      trend.push({
        month: start.toLocaleString("en", { month: "short", year: "2-digit" }),
        startDate: start.toISOString(),
        ...data,
      });
    } catch {
      trend.push({
        month: start.toLocaleString("en", { month: "short", year: "2-digit" }),
        revenue: 0, expenses: 0, profit: 0,
      });
    }
  }
  return trend;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

async function runAnalyticsDiagnostics() {
  const warnings = [];

  // Stale caches
  const staleCount = await ReportCache.countDocuments({ status: "stale" });
  if (staleCount > 0) {
    warnings.push({ code: "ANALYTICS_STALE_CACHE", message: `${staleCount} report cache(s) are stale and need regeneration.` });
  }

  // Expired but not yet purged (TTL index lag)
  const expiredCount = await ReportCache.countDocuments({ expiresAt: { $lt: new Date() }, status: "fresh" });
  if (expiredCount > 0) {
    warnings.push({ code: "ANALYTICS_EXPIRED_CACHE", message: `${expiredCount} cache record(s) have expired. TTL cleanup may be lagging.` });
    await ReportCache.updateMany({ expiresAt: { $lt: new Date() }, status: "fresh" }, { $set: { status: "stale" } });
  }

  // Check for mismatched reconciliation (confirmed > total transactions — anomaly)
  const totalBankTx = await BankTransaction.countDocuments({});
  const totalConfirmed = await ReconciliationMatch.countDocuments({ status: "confirmed" });
  if (totalConfirmed > totalBankTx && totalBankTx > 0) {
    warnings.push({ code: "ANALYTICS_RECON_MISMATCH", message: `Confirmed reconciliation matches (${totalConfirmed}) exceed total bank transactions (${totalBankTx}). Data anomaly detected.` });
    await IncidentLog.create({
      severity: "high", category: "analytics_anomaly", source: "analyticsEngine",
      message: "Confirmed reconciliation matches exceed total bank transactions",
    }).catch(() => {});
  }

  return { warnings };
}

module.exports = {
  generateKPISummary,
  generatePnLTrend,
  computeReceivablesAging,
  computePayablesAging,
  computeReconciliationMetrics,
  derivePnL,
  deriveCashPosition,
  invalidateCache,
  runAnalyticsDiagnostics,
};
