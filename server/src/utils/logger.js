/**
 * logger.js — Structured JSON logger for Nexfern FinanceOS.
 *
 * SAFETY RULES:
 *  - NEVER log secrets, tokens, passwords, or encryption keys.
 *  - All output is JSON-structured (machine-parseable by log aggregators).
 *  - Level: info | warn | error | audit | metric
 *  - "audit" entries are immutable and always written to stderr (never suppressed).
 */

const LEVELS = { info: "INFO", warn: "WARN", error: "ERROR", audit: "AUDIT", metric: "METRIC" };

// Fields that must never appear in log output
const REDACTED_KEYS = new Set([
  "password", "token", "secret", "key", "apiKey", "api_key",
  "apiSecret", "webhookSecret", "encryptionKey", "jwt", "authorization",
  "credentials", "backupKey", "privateKey",
]);

function redact(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(k.toLowerCase()) || REDACTED_KEYS.has(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = redact(v, depth + 1);
    }
  }
  return result;
}

function write(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: LEVELS[level] || "INFO",
    msg: message,
    ...(Object.keys(meta).length ? { meta: redact(meta) } : {}),
    pid: process.pid,
    env: process.env.NODE_ENV || "development",
  };
  const line = JSON.stringify(entry) + "\n";
  if (level === "error" || level === "audit") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

const logger = {
  info:   (msg, meta = {}) => write("info",   msg, meta),
  warn:   (msg, meta = {}) => write("warn",   msg, meta),
  error:  (msg, meta = {}) => write("error",  msg, meta),
  audit:  (msg, meta = {}) => write("audit",  msg, meta),
  metric: (msg, meta = {}) => write("metric", msg, meta),
};

module.exports = logger;
