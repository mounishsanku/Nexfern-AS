import type { Role } from "@/types/role";

function parsePermissions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((p) => String(p));
  } catch {
    // ignore JSON parse errors; fallback to comma-separated parsing
  }
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function getStoredRole(): Role {
  if (typeof window === "undefined") return "receptionist";
  const raw = window.localStorage.getItem("role");
  return (["admin", "accountant", "receptionist", "auditor"] as Role[]).includes(raw as Role)
    ? (raw as Role)
    : "receptionist";
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
