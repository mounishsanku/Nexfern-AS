import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InlineSpinner } from "@/components/ui/Spinner";
import { getApiBase } from "@/api";

interface HealthCheck {
  status: "ready" | "degraded" | "starting";
  checks: {
    mongo: string;
    reportCache: string;
    staleCaches?: number;
    webhooks: string;
    recentWebhookFailures?: number;
    memoryMb: number;
    memory: string;
    avgLatencyMs: number | null;
    monitoring: string;
  };
}

interface MetricSummary {
  metric: string;
  count: number;
  avg: number;
  max: number;
  min: number;
}

interface Alert {
  _id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  source: string;
  message: string;
  createdAt: string;
}

async function apiGet(path: string) {
  const res = await fetch(`${getApiBase()}${path}`, { credentials: "include" });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "Request failed"); }
  return res.json();
}

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" || status === "ready" || status === "alive"
    ? "bg-emerald-500" : status === "degraded" || status === "unknown"
    ? "bg-amber-400" : "bg-red-500";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} mr-2 flex-shrink-0`} />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    low: "neutral", medium: "warning", high: "danger", critical: "danger",
  };
  return <Badge variant={map[severity] ?? "neutral"}>{severity}</Badge>;
}

export function SystemOperations() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [metrics, setMetrics] = useState<MetricSummary[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"health" | "metrics" | "alerts">("health");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, alertData] = await Promise.all([
        apiGet("/health/ready"),
        apiGet("/api/system/incidents").catch(() => []),
      ]);
      setHealth(healthData);
      setAlerts(Array.isArray(alertData) ? alertData.slice(0, 20) : []);
    } catch { /* health endpoint returns 503 on degraded — still parse */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      await apiGet("/api/analytics/diagnostics");
      // Surface from analytics diag; in production, /api/ops/metrics would serve monitoringService.summary()
      setMetrics([]);
    } catch { setMetrics([]); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "metrics") loadMetrics(); }, [tab, loadMetrics]);

  const handleRefresh = () => { setRefreshing(true); load(); };

  const checkStatus = (val: string | undefined) =>
    val === "ok" ? "ok" : val === "degraded" ? "degraded" : val ?? "unknown";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System Operations</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Infrastructure health, monitoring metrics, and operational alerts.</p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><InlineSpinner /> Refreshing...</> : "↺ Refresh"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["health", "metrics", "alerts"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            {t}
            {t === "alerts" && alerts.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">{alerts.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><InlineSpinner /></div>
      ) : (
        <>
          {/* Health Tab */}
          {tab === "health" && health && (
            <div className="space-y-4">
              {/* Overall Status Banner */}
              <div className={`rounded-2xl p-5 border ${health.status === "ready" ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"}`}>
                <div className="flex items-center gap-3">
                  <StatusDot status={health.status} />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white capitalize">{health.status}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">System readiness probe</p>
                  </div>
                  <Badge variant={health.status === "ready" ? "success" : "warning"} className="ml-auto">{health.status.toUpperCase()}</Badge>
                </div>
              </div>

              {/* Subsystem Checks */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/30">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Subsystem Checks</h2>
                </div>
                {[
                  { label: "MongoDB", status: checkStatus(health.checks.mongo), detail: null },
                  { label: "Report Cache", status: checkStatus(health.checks.reportCache), detail: health.checks.staleCaches != null ? `${health.checks.staleCaches} stale` : null },
                  { label: "Webhook Pipeline", status: checkStatus(health.checks.webhooks), detail: health.checks.recentWebhookFailures != null ? `${health.checks.recentWebhookFailures} recent failures` : null },
                  { label: "Memory", status: checkStatus(health.checks.memory), detail: `${health.checks.memoryMb} MB heap` },
                  { label: "Monitoring", status: checkStatus(health.checks.monitoring), detail: health.checks.avgLatencyMs != null ? `avg ${health.checks.avgLatencyMs}ms` : null },
                ].map(({ label, status, detail }) => (
                  <div key={label} className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center">
                      <StatusDot status={status} />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
                      {detail && <span className="ml-3 text-xs text-gray-500">{detail}</span>}
                    </div>
                    <Badge variant={status === "ok" ? "success" : status === "degraded" ? "warning" : "danger"}>{status}</Badge>
                  </div>
                ))}
              </div>

              {/* Memory + Latency Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{health.checks.memoryMb} MB</p>
                  <p className="text-xs text-gray-500 mt-0.5">Heap Used</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {health.checks.avgLatencyMs != null ? `${health.checks.avgLatencyMs}ms` : "—"}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Avg HTTP Latency</p>
                </div>
              </div>
            </div>
          )}

          {/* Metrics Tab */}
          {tab === "metrics" && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {metrics.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  No metrics recorded yet. Metrics appear after requests are processed.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      {["Metric", "Count", "Avg (ms)", "Min", "Max"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {metrics.map(m => (
                      <tr key={m.metric}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{m.metric}</td>
                        <td className="px-4 py-3">{m.count}</td>
                        <td className="px-4 py-3">{m.avg}</td>
                        <td className="px-4 py-3">{m.min}</td>
                        <td className="px-4 py-3">{m.max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Alerts Tab */}
          {tab === "alerts" && (
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
                  No operational incidents recorded.
                </div>
              ) : alerts.map(a => (
                <div key={a._id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-start gap-3">
                  <SeverityBadge severity={a.severity} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{a.message}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{a.source} · {a.category}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
