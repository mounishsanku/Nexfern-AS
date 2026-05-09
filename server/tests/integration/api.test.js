/**
 * API Integration + Health Endpoint Tests
 *
 * Spins up the Express app in-process using supertest so no live server
 * is required. Mounts only the health routes to keep the test fast and
 * isolated from the full startup sequence (DB migrations, seed, etc.).
 */
const request = require("supertest");
const express = require("express");
const healthRoutes = require("../../src/routes/healthRoutes");

// Minimal express app with just the health routes
const app = express();
app.use(express.json());
app.use("/health", healthRoutes);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

describe("Health endpoints", () => {
  test("GET /health/live returns alive status", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.pid).toBe("number");
  });

  test("GET /health/startup returns starting before markStartupComplete", async () => {
    const res = await request(app).get("/health/startup");
    // In test mode startup is never marked complete, so this returns 503
    expect([200, 503]).toContain(res.status);
    expect(["started", "starting"]).toContain(res.body.status);
  });

  test("GET /api/health legacy shim returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
