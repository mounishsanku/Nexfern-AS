/**
 * envValidation.js — Startup environment guard.
 *
 * CRITICAL SAFETY RULES:
 *  - NEVER log the VALUE of any secret.
 *  - NEVER allow startup to succeed in production with missing critical secrets.
 *  - Only warn on missing non-critical variables.
 *  - JWT_SECRET must be >= 32 chars in production.
 *  - BACKUP_ENCRYPTION_KEY must be exactly 32 chars in production.
 */

const CRITICAL = "CRITICAL";
const WARNING  = "WARNING";

const isProduction = () => (process.env.NODE_ENV || "development") === "production";

const checks = [
  // ── Always Required ───────────────────────────────────────────────────────
  {
    level: CRITICAL,
    key: "MONGODB_URI",
    test: (v) => v && v.startsWith("mongodb"),
    message: "MONGODB_URI is missing or malformed. Cannot connect to database.",
  },
  {
    level: CRITICAL,
    key: "JWT_SECRET",
    test: (v) => v && v.length >= 16,
    message: "JWT_SECRET is missing or too short (minimum 16 chars).",
  },
  // ── Production-Only Critical ──────────────────────────────────────────────
  {
    level: CRITICAL,
    prodOnly: true,
    key: "JWT_SECRET",
    test: (v) => v && v.length >= 32 && v !== "change_me" && v !== "secret",
    message: "JWT_SECRET is weak or default. Production requires >= 32 chars, unique value.",
  },
  {
    level: CRITICAL,
    prodOnly: true,
    key: "BACKUP_ENCRYPTION_KEY",
    test: (v) => v && v.length === 32,
    message: "BACKUP_ENCRYPTION_KEY must be exactly 32 chars in production.",
  },
  // ── Warnings ──────────────────────────────────────────────────────────────
  {
    level: WARNING,
    key: "PORT",
    test: (v) => !!v,
    message: "PORT not set, defaulting to 5000.",
  },
  {
    level: WARNING,
    prodOnly: true,
    key: "CORS_ORIGINS",
    test: (v) => !!v,
    message: "CORS_ORIGINS not set in production — all origins will be reflected. Set to a specific domain.",
  },
  {
    level: WARNING,
    prodOnly: true,
    key: "AUDIT_STRICT",
    test: (v) => v === "true",
    message: "AUDIT_STRICT is not 'true' in production. Audit log failures will be silently swallowed.",
  },
];

/**
 * validateEnv() — call once at startup BEFORE any DB or server operations.
 * Throws on CRITICAL failures. Logs WARNINGs to stderr.
 * NEVER logs env var values.
 */
function validateEnv() {
  const isProd = isProduction();
  const criticalFailures = [];
  const warnings = [];

  for (const check of checks) {
    if (check.prodOnly && !isProd) continue;
    const value = process.env[check.key];
    const passed = check.test(value);
    if (!passed) {
      if (check.level === CRITICAL) criticalFailures.push(check.message);
      else warnings.push(check.message);
    }
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stderr.write(`[ENV WARNING] ${w}\n`);
    }
  }

  if (criticalFailures.length > 0) {
    process.stderr.write("\n[ENV CRITICAL] Startup blocked — the following issues must be resolved:\n");
    for (const f of criticalFailures) {
      process.stderr.write(`  ✗ ${f}\n`);
    }
    process.stderr.write("\n");
    // Only throw — caller (index.js) will handle exit
    const err = new Error(`Startup blocked: ${criticalFailures.length} critical environment error(s).`);
    err.code = "ENV_VALIDATION_FAILED";
    err.failures = criticalFailures;
    throw err;
  }

  return { ok: true, warnings };
}

module.exports = { validateEnv };
