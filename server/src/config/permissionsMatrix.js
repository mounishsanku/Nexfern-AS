/**
 * Single source of truth for Role-Based Access Control
 * Maps roles to permissions.
 */

const ROLES = {
  ADMIN: "admin",
  ACCOUNTANT: "accountant",
  AUDITOR: "auditor",
  RECEPTIONIST: "receptionist",
  USER: "user",
};

const PERMISSIONS = {
  // Invoices
  INVOICES_READ: "invoices.read",
  INVOICES_CREATE: "invoices.create",
  INVOICES_UPDATE: "invoices.update",
  INVOICES_DELETE: "invoices.delete",

  // Expenses
  EXPENSES_READ: "expenses.read",
  EXPENSES_CREATE: "expenses.create",
  EXPENSES_APPROVE: "expenses.approve",

  // Reports & Diagnostics
  REPORTS_READ: "reports.read",
  REPORTS_EXPORT: "reports.export",
  DIAGNOSTICS_RUN: "diagnostics.run",
  SYSTEM_BACKUP: "system.backup",
  SYSTEM_RESTORE: "system.restore",

  // Imports
  IMPORTS_STAGE: "imports.stage",
  IMPORTS_EXECUTE: "imports.execute",

  // Settings
  SETTINGS_WRITE: "settings.write",
  SECURITY_READ: "security.read",
  SECURITY_WRITE: "security.write",
};

const permissionsMatrix = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS), // Admin has all permissions

  [ROLES.ACCOUNTANT]: [
    PERMISSIONS.INVOICES_READ,
    PERMISSIONS.INVOICES_CREATE,
    PERMISSIONS.INVOICES_UPDATE,
    PERMISSIONS.EXPENSES_READ,
    PERMISSIONS.EXPENSES_CREATE,
    PERMISSIONS.EXPENSES_APPROVE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.DIAGNOSTICS_RUN,
    PERMISSIONS.IMPORTS_STAGE,
    PERMISSIONS.IMPORTS_EXECUTE,
  ],

  [ROLES.AUDITOR]: [
    PERMISSIONS.INVOICES_READ,
    PERMISSIONS.EXPENSES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.DIAGNOSTICS_RUN,
  ],

  [ROLES.RECEPTIONIST]: [
    PERMISSIONS.INVOICES_READ,
    PERMISSIONS.INVOICES_CREATE,
    PERMISSIONS.EXPENSES_READ,
    PERMISSIONS.EXPENSES_CREATE, // Cannot approve
  ],

  [ROLES.USER]: [],
};

function hasPermission(role, permission) {
  const allowed = permissionsMatrix[role] || [];
  return allowed.includes(permission);
}

module.exports = {
  ROLES,
  PERMISSIONS,
  permissionsMatrix,
  hasPermission,
};
