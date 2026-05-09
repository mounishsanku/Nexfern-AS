/**
 * rateLimitMiddleware.js — In-process sliding window rate limiter.
 *
 * No external Redis dependency — uses an in-memory Map per endpoint group.
 * For multi-instance deployments, replace with redis-based express-rate-limit.
 *
 * Window: sliding window per IP.
 */

const logger = require("../utils/logger");

const windows = new Map(); // key → [timestamp, ...]

function slidingWindowRateLimit({ windowMs, max, keyPrefix = "default", message }) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = windows.get(key) || [];
    // Drop old timestamps outside window
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      logger.warn("rateLimitMiddleware: rate limit exceeded", { key, count: timestamps.length, max });
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        status: "error",
        code: "RATE_LIMIT_EXCEEDED",
        message: message || "Too many requests. Please try again later.",
        retryAfterSeconds: retryAfter,
      });
    }

    timestamps.push(now);
    windows.set(key, timestamps);

    // Cleanup stale keys every 1000 requests to prevent memory growth
    if (windows.size > 1000) {
      for (const [k, ts] of windows) {
        if (ts.every((t) => t < cutoff)) windows.delete(k);
      }
    }

    next();
  };
}

// ── Prebuilt limiters ──────────────────────────────────────────────────────────

/** Auth endpoints: 10 attempts per 15 minutes per IP */
const authRateLimit = slidingWindowRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "auth",
  message: "Too many authentication attempts. Please wait 15 minutes.",
});

/** Webhook endpoints: 100 events per minute per IP */
const webhookRateLimit = slidingWindowRateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyPrefix: "webhook",
  message: "Webhook rate limit exceeded.",
});

/** Import endpoints: 5 imports per 10 minutes per IP */
const importRateLimit = slidingWindowRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyPrefix: "import",
  message: "Import rate limit exceeded. Please wait before starting another import.",
});

/** Analytics export: 20 requests per 5 minutes */
const analyticsRateLimit = slidingWindowRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyPrefix: "analytics",
  message: "Analytics export rate limit exceeded.",
});

module.exports = {
  slidingWindowRateLimit,
  authRateLimit,
  webhookRateLimit,
  importRateLimit,
  analyticsRateLimit,
};
