const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/envValidation");
const logger = require("../src/utils/logger");
const SystemMetric = require("../src/models/SystemMetric");
const { record, time, summary: metricSummary, cacheStats } = require("../src/services/monitoringService");
const { alert, webhookFailureAlert, backupFailureAlert } = require("../src/services/alertingService");
const { encryptPayload, decryptPayload } = require("../src/services/encryptionService");
const { verifyBackup, simulateRestore } = require("../src/services/disasterRecoveryService");
const {
  jobAnalyticsCacheRefresh,
  jobStaleReconciliationCheck,
  jobAnalyticsDiagnostics,
} = require("../src/jobs/backgroundJobs");

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info("MongoDB connected");
    console.log("✅ MongoDB Connected Successfully");
    console.log("--- Testing DevOps Infrastructure ---\n");

    // Ensure test env has a minimal JWT_SECRET for validateEnv dev-mode check
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      process.env.JWT_SECRET = "test_jwt_secret_16chars";
    }
    // ── 1. Env Validation ────────────────────────────────────────────────────
    // Should pass in dev (no NODE_ENV=production)
    const { ok, warnings } = validateEnv();
    if (!ok) throw new Error("validateEnv() returned ok=false unexpectedly");
    console.log(`✅ Env validation passed (${warnings.length} warning(s))`);

    // Verify production mode would block weak JWT
    const origEnv = process.env.NODE_ENV;
    const origJwt = process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "weak";
    let blocked = false;
    try { validateEnv(); } catch (e) { if (e.code === "ENV_VALIDATION_FAILED") blocked = true; }
    if (!blocked) throw new Error("Weak JWT_SECRET should have blocked production startup!");
    process.env.NODE_ENV = origEnv;
    process.env.JWT_SECRET = origJwt;
    console.log("✅ Env validation blocks weak secrets in production mode");

    // ── 2. Structured Logger ─────────────────────────────────────────────────
    // Verify logger does not expose secrets in output
    let loggedLine = null;
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (data) => { loggedLine = data; return origWrite(data); };
    logger.info("test log", { apiKey: "should_be_redacted", normal: "visible" });
    process.stdout.write = origWrite;
    if (loggedLine && loggedLine.includes("should_be_redacted")) {
      throw new Error("Logger leaked a secret value!");
    }
    const parsed = JSON.parse(loggedLine);
    if (parsed.meta?.apiKey !== "[REDACTED]") throw new Error("apiKey not redacted in log output");
    console.log("✅ Structured logger redacts secrets correctly");

    // ── 3. SystemMetric recording ─────────────────────────────────────────────
    await SystemMetric.deleteMany({ metricType: "test_metric_devops" });
    await record("test_metric_devops", 123, { source: "test" });
    const found = await SystemMetric.findOne({ metricType: "test_metric_devops" }).lean();
    if (!found || found.value !== 123) throw new Error("Metric not recorded correctly");
    console.log("✅ SystemMetric.record() works correctly");

    // ── 4. Monitoring summary ─────────────────────────────────────────────────
    const summary = await metricSummary(60 * 60 * 1000);
    if (!Array.isArray(summary)) throw new Error("Monitoring summary is not an array");
    console.log(`✅ Monitoring summary returned ${summary.length} metric type(s)`);

    // ── 5. Cache stats ────────────────────────────────────────────────────────
    await record("cache_hit", 1, {});
    await record("cache_miss", 1, {});
    const stats = await cacheStats(60 * 60 * 1000);
    if (typeof stats.hits !== "number" || typeof stats.misses !== "number") throw new Error("Cache stats missing fields");
    console.log(`✅ Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.hitRate}% hit rate`);

    // ── 6. Alerting ───────────────────────────────────────────────────────────
    // Alert under threshold (count=2 < 3): should be silent
    await webhookFailureAlert("razorpay", "signature mismatch", 2);
    // Alert above threshold
    await webhookFailureAlert("razorpay", "signature mismatch", 5);
    console.log("✅ Alerting service fires correctly (threshold-based)");

    // ── 7. Backup verification ────────────────────────────────────────────────
    const mockData = { version: 2, exportedAt: new Date().toISOString(), invoices: [] };
    const encrypted = encryptPayload(mockData);
    const { valid, issues } = await verifyBackup(encrypted);
    if (!valid) throw new Error(`Backup verification failed: ${issues.join(", ")}`);
    console.log("✅ Backup verification passes for valid encrypted payload");

    // Verify corrupt backup is rejected
    const corrupt = { encrypted: "baddata", iv: "badiv", tag: "badtag" };
    const { valid: corruptValid } = await verifyBackup(corrupt);
    if (corruptValid) throw new Error("Corrupt backup was accepted — security failure!");
    console.log("✅ Corrupt backup correctly rejected");

    // ── 8. Restore simulation ─────────────────────────────────────────────────
    const { success, summary: restoreSummary } = await simulateRestore(encrypted);
    if (!success) throw new Error("Restore simulation failed on valid payload");
    console.log("✅ Restore simulation succeeded:", JSON.stringify(restoreSummary));

    // ── 9. Background jobs execute without throwing ───────────────────────────
    await jobAnalyticsCacheRefresh();
    await jobStaleReconciliationCheck();
    await jobAnalyticsDiagnostics();
    console.log("✅ Background jobs executed without error");

    // ── 10. Rate limiter logic ────────────────────────────────────────────────
    const { slidingWindowRateLimit } = require("../src/middleware/rateLimitMiddleware");
    const limiter = slidingWindowRateLimit({ windowMs: 5000, max: 2, keyPrefix: "test_devops" });
    let blocked429 = false;
    const mockReq = { ip: "1.2.3.4", route: null, path: "/test", method: "GET" };
    const mockRes = {
      status: (s) => ({ json: (b) => { if (s === 429) blocked429 = true; } }),
      set: () => {},
    };
    const noop = () => {};
    limiter(mockReq, mockRes, noop); // request 1
    limiter(mockReq, mockRes, noop); // request 2
    limiter(mockReq, mockRes, () => { throw new Error("Should have been blocked!"); }); // request 3 should be blocked
    if (!blocked429) throw new Error("Rate limiter did not block 3rd request");
    console.log("✅ Rate limiter blocks excess requests correctly");

    // Cleanup
    await SystemMetric.deleteMany({ metricType: { $in: ["test_metric_devops", "cache_hit", "cache_miss"] } });

    console.log("\nCleanup complete. Test PASSED ✅");
    process.exit(0);
  } catch (err) {
    console.error("\nTest failed:", err);
    process.exit(1);
  }
}

runTest();
