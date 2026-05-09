const AccessLog = require("../models/AccessLog");

const SENSITIVE_ROUTES = [
  "/api/auth",
  "/api/import",
  "/api/system/backup",
  "/api/system/restore",
  "/api/settings",
  "/api/vouchers",
  "/api/localization-admin",
];

function isSensitiveRoute(url) {
  return SENSITIVE_ROUTES.some(route => url.startsWith(route));
}

function sanitizeBody(body) {
  if (!body) return {};
  const sanitized = { ...body };
  const sensitiveFields = ["password", "token", "mfaSecret", "backupCodes", "secret", "backup"];
  for (const field of sensitiveFields) {
    if (sanitized[field] !== undefined) {
      sanitized[field] = "[REDACTED]";
    }
  }
  return sanitized;
}

const accessLoggingMiddleware = async (req, res, next) => {
  const originalEnd = res.end;

  res.end = function (...args) {
    res.end = originalEnd;
    res.end(...args);

    // After response is sent, asynchronously log
    setImmediate(async () => {
      try {
        // Only log sensitive routes or failed auth/admin attempts
        const isAuth = req.url.startsWith("/api/auth");
        const isFailedAuth = isAuth && res.statusCode >= 400;
        
        if (isSensitiveRoute(req.originalUrl || req.url) || isFailedAuth) {
          await AccessLog.create({
            userId: req.user?.id || req.user?.sub || null,
            entityId: req.body?.entityId || req.query?.entityId || null,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get("user-agent") || "unknown",
            route: req.originalUrl || req.url,
            method: req.method,
            statusCode: res.statusCode,
            metadata: {
              query: req.query,
              body: sanitizeBody(req.body),
            },
            timestamp: new Date(),
          });
        }
      } catch (err) {
        // Failing to log should not crash the server
        console.error("AccessLogging Error:", err.message);
      }
    });
  };

  next();
};

module.exports = accessLoggingMiddleware;
