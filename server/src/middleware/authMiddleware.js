const jwt = require("jsonwebtoken");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return sendStructuredError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Unauthorized",
        action: ACTION.FIX_REQUIRED,
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return sendStructuredError(res, {
        status: 503,
        code: "JWT_SECRET_MISSING",
        message: "Authentication is not configured on the server",
        action: ACTION.CONTACT_ADMIN,
      });
    }

    const decoded = jwt.verify(token, secret);
    const userId = decoded?.sub;

    if (!userId) {
      return sendStructuredError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Unauthorized",
        action: ACTION.FIX_REQUIRED,
      });
    }

    // Attach the decoded JWT payload for downstream RBAC checks.
    req.user = decoded;
    return next();
  } catch (_err) {
    return sendStructuredError(res, {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
      action: ACTION.FIX_REQUIRED,
    });
  }
}

module.exports = { requireAuth };

