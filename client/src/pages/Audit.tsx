import * as React from "react";
import { apiFetch, getStoredToken, downloadCsv } from "@/api";
import { Container } from "@/components/ui/Container";

type AuditRow = {
  _id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  metadata?: Record<string, unknown> | null;
};

const ENTITY_OPTIONS = ["", "invoice", "payment", "expense", "voucher", "revenue_schedule", "auth"];

export function Audit() {
  const token = getStoredToken();
  const [logs, setLogs] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [entityType, setEntityType] = React.useState("");
  const [exporting, setExporting] = React.useState(false);

  async function fetchLogs() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (entityType) params.set("entityType", entityType);
      const qs = params.toString();
      const data = await apiFetch<AuditRow[]>(`/audit/logs${qs ? `?${qs}` : ""}`, { token });
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  async function exportAudit() {
    if (!token) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (entityType) params.set("entityType", entityType);
      const qs = params.toString();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await downloadCsv(`/audit/export${qs ? `?${qs}` : ""}`, `audit-export-${stamp}.csv`);
    } catch {
      // non-fatal
    } finally {
      setExporting(false);
    }
  }

  React.useEffect(() => {
    void fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container className="py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">Audit Trail</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
            Who did what and when
          </h1>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Entity</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt || "_all"} value={opt}>
                  {opt || "All"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => void fetchLogs()}
              className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-soft hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => void exportAudit()}
              disabled={exporting}
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-soft hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="text-sm font-semibold text-slate-600">Audit log</div>
          {logs.length > 0 && (
            <div className="text-xs font-semibold text-slate-400">
              {logs.length} record{logs.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {loading ? (
          <div className="px-6 pb-6 text-sm text-slate-500">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-slate-500">No audit logs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Entity</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log._id} className="bg-white hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900">{log.userName}</td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {log.entityType}
                      {log.entityId ? ` #${String(log.entityId).slice(-6)}` : ""}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString("en-IN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Container>
  );
}
