import { useState, useEffect, useCallback } from "react";
import { useLocalization } from "@/context/LocalizationContext";
import { useToast } from "@/context/useToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InlineSpinner } from "@/components/ui/Spinner";
import { getApiBase } from "@/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KPIs {
  revenue: number;
  expenses: number;
  profit: number;
  grossMargin: number;
  cashPosition: number;
  cashBreakdown: { cash: number; bank: number; total: number };
  receivablesTotal: number;
  receivablesBuckets: Record<string, number>;
  payablesTotal: number;
  payablesBuckets: Record<string, number>;
  cashRunwayMonths: number | null;
  reconciliation: { total: number; confirmed: number; reversed: number; pendingTransactions: number; efficiency: number };
  generatedAt: string;
  _cached: boolean;
}

interface TrendPoint {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiGet(path: string) {
  const res = await fetch(`${getApiBase()}${path}`, { credentials: "include" });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "Request failed"); }
  return res.json();
}

function fmt(n: number | null | undefined, prefix = "₹") {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e7) return `${prefix}${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `${prefix}${(n / 1e5).toFixed(2)}L`;
  return `${prefix}${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pct(n: number | null | undefined) {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

// ── Mini sparkline (SVG, no deps) ─────────────────────────────────────────────

function Sparkline({ data, color = "#3b82f6" }: { data: number[]; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const W = 120, H = 36, pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (W - 2 * pad);
    const y = H - pad - ((v - min) / range) * (H - 2 * pad);
    return `${x},${y}`;
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.join(" ")} />
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, trend, color = "#3b82f6", badge }: {
  label: string; value: string; sub?: string; trend?: number[]; color?: string; badge?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
        {badge}
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
        </div>
        {trend && <Sparkline data={trend} color={color} />}
      </div>
    </div>
  );
}

// ── Aging Bar ─────────────────────────────────────────────────────────────────

function AgingBar({ buckets, total, colors }: {
  buckets: Record<string, number>;
  total: number;
  colors: Record<string, string>;
}) {
  if (total === 0) return <p className="text-sm text-gray-400 dark:text-gray-500">No outstanding items</p>;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {Object.entries(buckets).map(([k, v]) => v > 0 ? (
          <div key={k} style={{ width: `${(v / total) * 100}%`, background: colors[k] ?? "#94a3b8" }} />
        ) : null)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(buckets).map(([k, v]) => v > 0 ? (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: colors[k] ?? "#94a3b8" }} />
            <span className="text-xs text-gray-500">{k.replace("_", "-")} d: {fmt(v)}</span>
          </div>
        ) : null)}
      </div>
    </div>
  );
}

const RECV_COLORS: Record<string, string> = { current: "#10b981", "1_30": "#f59e0b", "31_60": "#f97316", "61_90": "#ef4444", "over_90": "#7f1d1d" };
const PAY_COLORS: Record<string, string> = { current: "#6366f1", "1_30": "#8b5cf6", "31_60": "#d946ef", "61_90": "#ec4899", "over_90": "#7f1d1d" };

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const { features } = useLocalization();
  const { error: toastError } = useToast();

  const useAnalytics = features?.USE_ANALYTICS_ENGINE === true;

  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [trendMonths, setTrendMonths] = useState(6);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (bust = false) => {
    setLoading(true);
    try {
      const [kpiData, trendData] = await Promise.all([
        apiGet(`/api/analytics/kpi?useCache=${bust ? "false" : "true"}`),
        apiGet(`/api/analytics/trend?months=${trendMonths}`),
      ]);
      setKpis(kpiData);
      setTrend(trendData);
    } catch (e: any) { toastError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [trendMonths]);

  useEffect(() => { if (useAnalytics) load(); }, [useAnalytics, load]);

  const handleRefresh = () => { setRefreshing(true); load(true); };

  if (!useAnalytics) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center min-h-[400px]">
        <div className="w-16 h-16 mb-4 text-gray-300">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">Analytics Disabled</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          Enable <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">USE_ANALYTICS_ENGINE</code> to access the executive dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Executive KPIs derived from accounting ledger
            {kpis?._cached && <span className="ml-2 text-xs text-amber-500">· Cached</span>}
            {kpis?.generatedAt && <span className="ml-1 text-xs text-gray-400">· {new Date(kpis.generatedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><InlineSpinner /> Refreshing...</> : "↺ Refresh"}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><InlineSpinner /></div>
      ) : kpis ? (
        <>
          {/* Executive KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              label="Revenue"
              value={fmt(kpis.revenue)}
              sub="Period total"
              trend={trend.map(t => t.revenue)}
              color="#10b981"
            />
            <KPICard
              label="Net Profit"
              value={fmt(kpis.profit)}
              sub={`Margin: ${pct(kpis.grossMargin)}`}
              trend={trend.map(t => t.profit)}
              color={kpis.profit >= 0 ? "#10b981" : "#ef4444"}
              badge={<Badge variant={kpis.profit >= 0 ? "success" : "danger"}>{kpis.profit >= 0 ? "↑" : "↓"}</Badge>}
            />
            <KPICard
              label="Cash Position"
              value={fmt(kpis.cashPosition)}
              sub={kpis.cashRunwayMonths ? `Runway: ${kpis.cashRunwayMonths}mo` : undefined}
              trend={trend.map(t => t.revenue - t.expenses)}
              color="#6366f1"
            />
            <KPICard
              label="Receivables"
              value={fmt(kpis.receivablesTotal)}
              sub="Outstanding invoices"
              color="#f59e0b"
              badge={kpis.receivablesTotal > 0 ? <Badge variant="warning">Due</Badge> : undefined}
            />
          </div>

          {/* P&L Trend */}
          {trend.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">P&L Trend</h2>
                <div className="flex gap-1">
                  {[3, 6, 12].map(m => (
                    <button
                      key={m}
                      onClick={() => setTrendMonths(m)}
                      className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${trendMonths === m ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                    >
                      {m}M
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {["Month", "Revenue", "Expenses", "Profit", "Margin"].map(h => (
                        <th key={h} className="pb-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {trend.map(row => {
                      const margin = row.revenue > 0 ? ((row.profit / row.revenue) * 100).toFixed(1) : "0.0";
                      return (
                        <tr key={row.month}>
                          <td className="py-2.5 font-medium text-gray-900 dark:text-white">{row.month}</td>
                          <td className="py-2.5 text-emerald-600 dark:text-emerald-400">{fmt(row.revenue)}</td>
                          <td className="py-2.5 text-red-500">{fmt(row.expenses)}</td>
                          <td className={`py-2.5 font-semibold ${row.profit >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600"}`}>{fmt(row.profit)}</td>
                          <td className="py-2.5 text-gray-500">{margin}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Aging + Reconciliation Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Receivables Aging */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Receivables Aging</h2>
                <span className="text-lg font-bold text-amber-600">{fmt(kpis.receivablesTotal)}</span>
              </div>
              <AgingBar buckets={kpis.receivablesBuckets} total={kpis.receivablesTotal} colors={RECV_COLORS} />
            </div>

            {/* Payables Aging */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Payables Aging</h2>
                <span className="text-lg font-bold text-purple-600">{fmt(kpis.payablesTotal)}</span>
              </div>
              <AgingBar buckets={kpis.payablesBuckets} total={kpis.payablesTotal} colors={PAY_COLORS} />
            </div>
          </div>

          {/* Reconciliation Health */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-5">Reconciliation Health</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: "Total Matches", value: kpis.reconciliation.total.toString(), color: "text-gray-700 dark:text-gray-300" },
                { label: "Confirmed", value: kpis.reconciliation.confirmed.toString(), color: "text-emerald-600" },
                { label: "Reversed", value: kpis.reconciliation.reversed.toString(), color: "text-amber-500" },
                { label: "Pending Tx", value: kpis.reconciliation.pendingTransactions.toString(), color: "text-red-500" },
                { label: "Efficiency", value: `${kpis.reconciliation.efficiency}%`, color: kpis.reconciliation.efficiency >= 80 ? "text-emerald-600" : "text-amber-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            {/* Efficiency bar */}
            <div className="mt-4 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${kpis.reconciliation.efficiency}%`,
                  background: kpis.reconciliation.efficiency >= 80 ? "#10b981" : kpis.reconciliation.efficiency >= 50 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
          </div>

          {/* Cash Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Cash & Bank Position</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Cash on Hand", value: fmt(kpis.cashBreakdown.cash) },
                { label: "Bank Balance", value: fmt(kpis.cashBreakdown.bank) },
                { label: "Total Liquidity", value: fmt(kpis.cashBreakdown.total) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 text-center">
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
