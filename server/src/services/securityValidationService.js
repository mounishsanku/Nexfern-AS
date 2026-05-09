const User = require("../models/User");
const Entity = require("../models/Entity");

async function validateSecurityConfig() {
  const warnings = [];

  if (!process.env.JWT_SECRET) {
    warnings.push({ code: "SEC_MISSING_JWT_SECRET", message: "JWT_SECRET is missing. Authentication relies on insecure defaults." });
  }

  if (!process.env.BACKUP_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY.length !== 32) {
    warnings.push({ code: "SEC_MISSING_BACKUP_KEY", message: "BACKUP_ENCRYPTION_KEY is missing or not 32-bytes. Backups may fail in production." });
  }

  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "demo") {
    warnings.push({ code: "SEC_DEV_MODE", message: "NODE_ENV is not production or demo. Debug flags and verbose errors might be exposed." });
  }

  const corsOrigins = process.env.CORS_ORIGINS;
  if (!corsOrigins || corsOrigins === "*") {
    warnings.push({ code: "SEC_PERMISSIVE_CORS", message: "CORS_ORIGINS is very permissive. Restrict it to trusted domains." });
  }

  const adminsWithoutMfa = await User.countDocuments({ role: "admin", mfaEnabled: false });
  if (adminsWithoutMfa > 0) {
    warnings.push({ code: "SEC_ADMIN_MFA_DISABLED", message: `${adminsWithoutMfa} admin(s) do not have MFA enabled.` });
  }

  const entities = await Entity.find({ country: "IN" }).lean();
  for (const entity of entities) {
    if (!entity.gstin) {
      warnings.push({ code: "SEC_MISSING_GSTIN", message: `Entity "${entity.name}" is missing a GSTIN.` });
    }
    if (!entity.eInvoiceConfig?.username || !entity.eInvoiceConfig?.password) {
      warnings.push({ code: "SEC_MISSING_NIC_CREDS", message: `Entity "${entity.name}" is missing NIC e-invoice credentials.` });
    }
  }

  return { warnings };
}

module.exports = {
  validateSecurityConfig,
};
