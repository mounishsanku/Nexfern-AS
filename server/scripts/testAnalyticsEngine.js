const mongoose = require("mongoose");
const ReportCache = require("../src/models/ReportCache");
const { hashFilters } = require("../src/models/ReportCache");
const {
  generateKPISummary,
  generatePnLTrend,
  computeReceivablesAging,
  computePayablesAging,
  computeReconciliationMetrics,
  invalidateCache,
  runAnalyticsDiagnostics,
} = require("../src/services/analyticsEngine");

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected Successfully");
    console.log("--- Testing Analytics Engine ---\n");

    // 1. KPI generation derives from accounting sources without throwing
    const kpis = await generateKPISummary({}, null, { useCache: false });
    if (typeof kpis.revenue !== "number") throw new Error("KPI revenue is not a number");
    if (typeof kpis.profit !== "number") throw new Error("KPI profit is not a number");
    if (typeof kpis.grossMargin !== "number") throw new Error("KPI grossMargin is not a number");
    if (kpis._cached !== false) throw new Error("First call should not be cached");
    console.log(`✅ KPI summary generated: revenue=${kpis.revenue}, profit=${kpis.profit}, margin=${kpis.grossMargin}%`);

    // 2. Cache write + hit
    const kpis2 = await generateKPISummary({}, null, { useCache: true });
    // First call with useCache=true writes and returns fresh
    const kpis3 = await generateKPISummary({}, null, { useCache: true });
    if (kpis3._cached !== true) throw new Error("Second cached call should return _cached=true");
    console.log("✅ Report cache write + hit working correctly");

    // 3. Cache invalidation marks status stale
    await invalidateCache("kpi_summary", null);
    const staleCache = await ReportCache.findOne({ reportType: "kpi_summary", status: "stale" }).lean();
    if (!staleCache) throw new Error("Cache invalidation did not mark record stale");
    console.log("✅ Cache invalidation marks records stale correctly");

    // 4. filtersHash is deterministic
    const h1 = hashFilters({ financialYearId: "abc", entityId: "xyz" });
    const h2 = hashFilters({ entityId: "xyz", financialYearId: "abc" }); // different key order
    if (h1 !== h2) throw new Error("filtersHash is not deterministic — key order matters!");
    const h3 = hashFilters({ financialYearId: "different" });
    if (h1 === h3) throw new Error("Different filters produced the same hash — collision!");
    console.log("✅ filtersHash is deterministic and order-independent");

    // 5. P&L trend generates correct number of months
    const trend = await generatePnLTrend(3);
    if (!Array.isArray(trend) || trend.length !== 3) throw new Error(`Expected 3 trend points, got ${trend.length}`);
    for (const point of trend) {
      if (typeof point.revenue !== "number") throw new Error("Trend point missing revenue");
      if (typeof point.profit !== "number") throw new Error("Trend point missing profit");
    }
    console.log(`✅ P&L trend generated for 3 months: [${trend.map(t => t.month).join(", ")}]`);

    // 6. Receivables aging returns valid bucket structure
    const recv = await computeReceivablesAging();
    const expectedBuckets = ["current", "1_30", "31_60", "61_90", "over_90"];
    for (const b of expectedBuckets) {
      if (recv.buckets[b] === undefined) throw new Error(`Missing receivables bucket: ${b}`);
    }
    if (typeof recv.total !== "number") throw new Error("Receivables total is not a number");
    console.log(`✅ Receivables aging structure valid: total=${recv.total}`);

    // 7. Payables aging returns valid structure
    const pay = await computePayablesAging();
    if (typeof pay.total !== "number") throw new Error("Payables total is not a number");
    console.log(`✅ Payables aging structure valid: total=${pay.total}`);

    // 8. Reconciliation metrics
    const recon = await computeReconciliationMetrics();
    if (typeof recon.efficiency !== "number" || recon.efficiency < 0 || recon.efficiency > 100) {
      throw new Error(`Reconciliation efficiency out of bounds: ${recon.efficiency}`);
    }
    console.log(`✅ Reconciliation metrics valid: efficiency=${recon.efficiency}%`);

    // 9. Diagnostics surface warnings
    const diag = await runAnalyticsDiagnostics();
    if (!Array.isArray(diag.warnings)) throw new Error("Diagnostics did not return warnings array");
    console.log(`✅ Analytics diagnostics returned ${diag.warnings.length} warning(s)`);

    // 10. Profit consistency: revenue - expenses = profit
    if (Math.abs((kpis.revenue - kpis.expenses) - kpis.profit) > 0.05) {
      throw new Error(`KPI profit math inconsistency: ${kpis.revenue} - ${kpis.expenses} ≠ ${kpis.profit}`);
    }
    console.log("✅ KPI profit math consistent: revenue - expenses = profit");

    // Cleanup test cache records
    await ReportCache.deleteMany({ reportType: "kpi_summary" });

    console.log("\nCleanup complete. Test PASSED ✅");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
}

runTest();
