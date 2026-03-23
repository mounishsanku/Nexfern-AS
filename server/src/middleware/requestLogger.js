function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const rid = Math.random().toString(36).slice(2, 8);

  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    // Basic structured request log for production diagnostics.
    console.log(
      `[req:${rid}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`
    );
  });

  next();
}

module.exports = { requestLogger };
