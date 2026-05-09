const logger = require("../utils/logger");
const crypto = require("crypto");

/**
 * requestLogger — Structured HTTP access log.
 *
 * Emits one log line per completed request with:
 *  - rid: random request ID (also set as X-Request-Id response header for trace correlation)
 *  - method, url, status, durationMs
 *  - userId (if authenticated)
 *
 * NEVER logs request body or query params (avoids PII / credentials in logs).
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const rid = crypto.randomBytes(6).toString("hex");

  // Propagate request ID so clients can correlate errors with server logs
  res.setHeader("X-Request-Id", rid);

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.sub ?? req.user?.id ?? null;
    logger.info("http_request", {
      rid,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId,
    });
  });

  next();
}

module.exports = { requestLogger };
