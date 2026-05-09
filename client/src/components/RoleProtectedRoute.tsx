import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Role } from "@/types/role";
import { getStoredRole, hasStoredPermission } from "@/utils/roleAuth";

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
