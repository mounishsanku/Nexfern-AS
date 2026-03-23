/**
 * API base must end with `/api` so paths like `/expenses` resolve to `/api/expenses`.
 * - `VITE_API_URL` may be `http://localhost:5000` or `http://localhost:5000/api` (normalized).
 * - In dev, `VITE_USE_PROXY=1` uses same-origin `/api` (Vite proxy → backend) to avoid CORS issues.
 */
import { nexfernCsvFilename } from "@/lib/exportFilename";

/** Collapse accidental `/api/api` chains and ensure exactly one trailing `/api`. */
function normalizeHttpApiBase(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  while (base.includes("/api/api")) {
    base = base.replace(/\/api\/api/g, "/api");
  }
  if (!base) return "";
  if (!/\/api$/i.test(base)) {
    base = `${base}/api`;
  }
  return base;
}

function normalizeRelativeApiBase(raw: string): string {
  let s = (raw || "/api").trim().replace(/\/+$/, "") || "/api";
  while (s.includes("/api/api")) {
    s = s.replace(/\/api\/api/g, "/api");
  }
  if (!/\/api$/i.test(s)) {
    s = `${s}/api`;
  }
  return s.startsWith("/") ? s : `/${s}`;
}

export function getApiBase(): string {
  const useProxy =
    import.meta.env.VITE_USE_PROXY === "true" || import.meta.env.VITE_USE_PROXY === "1";
  if (import.meta.env.DEV && useProxy && typeof window !== "undefined") {
    return normalizeRelativeApiBase("/api");
  }

  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  let base = fromEnv || "";
  if (!base && typeof window !== "undefined") {
    base = `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return normalizeHttpApiBase(base);
}

export const API = getApiBase();

/** Use in UI: show Retry when the API returned a recoverable code or explicit RETRY action. */
export function shouldOfferApiRetry(err: unknown): boolean {
  const e = err as Error & { action?: string; code?: string; status?: number };
  if (e.action === "RETRY") return true;
  const c = e.code;
  if (c === "SYSTEM_NOT_READY" || c === "PRECHECK_FAILED" || c === "AUTO_RECOVERED") {
    return true;
  }
  if (e.status === 503) return true;
  return false;
}

type ApiFetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  token?: string | null;
};

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("token");
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      credentials: "include",
      ...rest,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const err = new Error(
      `API_SERVER_UNREACHABLE (${reason}). Target: ${url || "(empty base)"}. Is the backend running?`,
    ) as Error & { code?: string };
    err.code = "API_SERVER_UNREACHABLE";
    throw err;
  }

  if (!res.ok) {
    let msg = `Request failed with status ${res.status}`;
    let code: string | undefined;
    let action: string | undefined;
    let issues: unknown[] | undefined;
    let details: unknown;
    try {
      const data = (await res.json()) as {
        message?: string;
        code?: string;
        action?: string;
        issues?: unknown[];
        details?: unknown;
      };
      if (data.message) msg = data.message;
      code = data.code;
      action = data.action;
      details = data.details;
      issues = data.issues ?? (data.details as { issues?: unknown[] } | undefined)?.issues;
    } catch {
      // response body is not JSON
    }
    const err = new Error(msg) as Error & {
      code?: string;
      action?: string;
      issues?: unknown[];
      details?: unknown;
      status?: number;
    };
    if (code) err.code = code;
    if (action) err.action = action;
    if (issues) err.issues = issues;
    if (details !== undefined) err.details = details;
    err.status = res.status;
    throw err;
  }

  return res.json() as Promise<T>;
}

export async function apiFetchBlob(
  path: string,
  options: Omit<ApiFetchOptions, "body"> = {},
): Promise<Blob> {
  const { token, headers: extraHeaders, ...rest } = options;
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      credentials: "include",
      ...rest,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `API_SERVER_UNREACHABLE (${reason}). Target: ${url || "(empty base)"}. Is the backend running?`,
    );
  }
  if (!res.ok) {
    let msg = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) msg = data.message;
    } catch {
      // no-op
    }
    throw new Error(msg);
  }
  return res.blob();
}

export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: Omit<ApiFetchOptions, "body" | "headers"> = {},
): Promise<T> {
  const { token, ...rest } = options;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: formData,
      headers,
      credentials: "include",
      ...rest,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `API_SERVER_UNREACHABLE (${reason}). Target: ${url || "(empty base)"}. Is the backend running?`,
    );
  }

  if (!res.ok) {
    let msg = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) msg = data.message;
    } catch {
      // no-op
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export type GstInvoice = {
  invoiceNumber: string;
  date: string;
  customerName: string;
  gstType: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAmount: number;
};

export type Gstr1Data = {
  invoices: GstInvoice[];
  totalSales: number;
  totalTax: number;
};

export type Gstr3bData = {
  outwardTax: number;
  inwardTax: number;
  netPayable: number;
};

export async function downloadGstReport(
  report: "gstr1" | "gstr3b",
  format: "json" | "csv",
): Promise<void> {
  const token = getStoredToken();
  const endpoint = `/reports/gst/export/${report}${format === "csv" ? "/csv" : ""}`;

  try {
    const blob = await apiFetchBlob(endpoint, { token });
    const filename =
      format === "csv"
        ? nexfernCsvFilename(report)
        : `nexfern_${report}_${new Date().toISOString().slice(0, 10)}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (error) {
    console.error("Download error:", error);
    throw new Error(`Failed to download ${report.toUpperCase()}: ${(error as Error).message}`);
  }
}

/** GET CSV (or any blob) and trigger browser download. */
export async function downloadCsv(pathWithQuery: string, defaultFilename: string): Promise<void> {
  const token = getStoredToken();
  const blob = await apiFetchBlob(pathWithQuery, { token });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/** POST JSON backup blob download (uses Content-Disposition filename when present). */
export async function downloadJsonBackup(path: string, fallbackFilename: string): Promise<void> {
  const token = getStoredToken();
  const url = `${API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `API_SERVER_UNREACHABLE (${reason}). Target: ${url || "(empty base)"}. Is the backend running?`,
    );
  }
  if (!res.ok) {
    let msg = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) msg = data.message;
    } catch {
      // no-op
    }
    throw new Error(msg);
  }
  let filename = fallbackFilename;
  const cd = res.headers.get("Content-Disposition");
  if (cd) {
    const m = /filename="([^"]+)"/.exec(cd) ?? /filename=([^;\s]+)/.exec(cd);
    if (m?.[1]) filename = m[1].trim();
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
