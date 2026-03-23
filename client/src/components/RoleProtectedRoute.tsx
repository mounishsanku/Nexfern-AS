import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

export type Role = "admin" | "accountant" | "receptionist" | "auditor";

export function getStoredRole(): Role {
  if (typeof window === "undefined") return "receptionist";
  const raw = window.localStorage.getItem("role");
  return (["admin", "accountant", "receptionist", "auditor"] as Role[]).includes(raw as Role)
    ? (raw as Role)
    : "receptionist";
}

function parsePermissions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((p) => String(p));
  } catch {
    // ignore JSON parse errors; fallback to comma-separated parsing
  }
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function hasStoredPermission(permission: string): boolean {
  if (typeof window === "undefined") return false;
  const perms = parsePermissions(window.localStorage.getItem("permissions"));
  if (perms.length === 0) {
    const role = getStoredRole();
    if (permission === "PAYROLL_MANAGE" || permission === "TDS_MANAGE") {
      return role === "admin" || role === "accountant";
    }
    return false;
  }
  return perms.includes(permission);
}

function AccessDenied() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-lg font-semibold text-slate-900">Access Denied</p>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        You do not have permission to view this page.
      </p>
    </div>
  );
}

export function RoleProtectedRoute({
  allowedRoles,
  requiredPermission,
  children,
}: {
  allowedRoles: Role[];
  /** When set, user must have this permission (see hasStoredPermission). */
  requiredPermission?: string;
  children: ReactNode;
}) {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null;
  const role = getStoredRole();

  if (!token) return <Navigate to="/login" replace />;
  if (requiredPermission && !hasStoredPermission(requiredPermission)) {
    return <AccessDenied />;
  }
  if (!allowedRoles.includes(role)) return <AccessDenied />;

  return <>{children}</>;
}
