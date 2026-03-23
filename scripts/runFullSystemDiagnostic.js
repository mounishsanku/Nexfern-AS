/**
 * CLI: run full system diagnostic (detect → fix → verify).
 * Usage: node scripts/runFullSystemDiagnostic.js
 * Requires MONGODB_URI in server/.env
 */

const path = require("path");
const fs = require("fs");

const serverRoot = path.join(__dirname, "..", "server");
const envPath = path.join(serverRoot, ".env");
require(path.join(serverRoot, "node_modules", "dotenv")).config(
  fs.existsSync(envPath) ? { path: envPath } : {},
);

const mongoose = require(path.join(serverRoot, "node_modules", "mongoose"));
const { connectDb } = require(path.join(serverRoot, "src", "config", "db"));
const { runFullSystemDiagnostics } = require(path.join(serverRoot, "src", "services", "systemHealService"));

async function main() {
  await connectDb();
  const report = await runFullSystemDiagnostics({ reason: "cli" });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
