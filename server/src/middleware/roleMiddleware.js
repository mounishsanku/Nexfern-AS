const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

module.exports = function (...allowedRoles) {
  const validRoles = new Set(["admin", "accountant", "receptionist", "auditor", "user"]);
  const allowed = (allowedRoles ?? [])
    .flatMap((r) => (Array.isArray(r) ? r : [r]))
    .map((r) => String(r).toLowerCase());

  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (!validRoles.has(role)) {
      return sendStructuredError(res, {
        status: 403,
        code: "FORBIDDEN_INVALID_ROLE",
        message: "Forbidden: Invalid role",
        action: ACTION.CONTACT_ADMIN,
      });
    }
    if (!allowed.includes(role)) {
      return sendStructuredError(res, {
        status: 403,
        code: "FORBIDDEN",
        message: "Forbidden: Access denied",
        action: ACTION.CONTACT_ADMIN,
      });
    }
    return next();
  };
};

