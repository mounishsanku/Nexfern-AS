import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { apiFetch, getStoredToken } from "@/api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { FinancialYearWidget } from "@/components/FinancialYearWidget";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

type Summary = {
  revenue: number;
  expenses: number;
  profit: number;
  cashBalance: number;
  receivables: number;
  payables: number;
  negativeCashDetected?: boolean;
  warning?: string | null;
  revenueSplit?: { project: number; academy: number; event: number };
  departmentSummary?: {
    academy: { revenue: number; expenses: number; profit: number };
    tech: { revenue: number; expenses: number; profit: number };
    marketing: { revenue: number; expenses: number; profit: number };
  };
};

type MonthlyRow = { month: string; revenue: number; expenses: number };

type ValidateError = { code: string; message: string; severity?: string };
type ValidateResponse = {
  generatedAt: string;
  errors: ValidateError[];
  warnings: ValidateError[];
  metrics: Record<string, unknown>;
};

type Invoice = {
  _id: string;
  customer?: { name?: string } | null;
  totalAmount?: number;
  status?: string;
  createdAt?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

function fmt0(n: number) {
  return formatCurrency(n, { maximumFractionDigits: 0 });
}

function profitMargin(revenue: number, profit: number) {
  if (!revenue) return "—";
  return `${((profit / revenue) * 100).toFixed(1)}%`;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "text-emerald-700 bg-emerald-50 ring-emerald-200",
  draft: "text-slate-600 bg-slate-100 ring-slate-200",
  sent: "text-blue-700 bg-blue-50 ring-blue-200",
  overdue: "text-rose-700 bg-rose-50 ring-rose-200",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{children}</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  icon,
  alert,
}: {
  label: string;
  value: number;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col justify-between rounded-xl bg-white p-5 ring-1 ring-inset shadow-sm transition-shadow hover:shadow-md",
        alert ? "ring-rose-200 bg-rose-50/30" : "ring-slate-200/70"
      )}
      style={{ minHeight: 128 }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", accent)}>
          {icon}
        </span>
      </div>
      <div className="mt-3">
        <p className={cx("text-[22px] font-extrabold tabular-nums leading-none tracking-tight", alert ? "text-rose-600" : "text-slate-900")}>
          {fmt0(value)}
        </p>
        {sub && <p className="mt-1.5 text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function BuCard({
  label,
  revenue,
  profit,
  tag,
  accentBg,
  accentText,
}: {
  label: string;
  revenue: number;
  profit: number;
  tag: string;
  accentBg: string;
  accentText: string;
}) {
  const isPos = profit >= 0;
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-slate-200/70 shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-black", accentBg, accentText)}>
          {tag}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <p className="text-lg font-extrabold tabular-nums text-slate-900">{fmt0(revenue)}</p>
      <p className="mt-1 text-[11px] text-slate-400">Revenue</p>
      <div className="mt-3 flex items-center gap-1.5">
        <span className={cx("text-[11px] font-bold", isPos ? "text-emerald-600" : "text-rose-600")}>
          {isPos ? "+" : ""}
          {fmt0(profit)}
        </span>
        <span className="text-[10px] text-slate-400">profit · {profitMargin(revenue, profit)} margin</span>
      </div>
    </div>
  );
}

function AlertPanel({ warnings }: { warnings: ValidateError[] }) {
  const secWarnings = warnings.filter((w) => w.code.startsWith("SEC_") || w.code.startsWith("SYS_") || w.code.startsWith("CFG_"));
  if (!secWarnings.length) return null;

  const hasError = secWarnings.some((w) => w.severity === "error");
  return (
    <div className={cx(
      "rounded-xl p-4 ring-1 ring-inset",
      hasError ? "bg-rose-50 ring-rose-200" : "bg-amber-50 ring-amber-200"
    )}>
      <div className="mb-2 flex items-center gap-2">
        <svg className={cx("h-4 w-4 shrink-0", hasError ? "text-rose-600" : "text-amber-600")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className={cx("text-xs font-bold uppercase tracking-wider", hasError ? "text-rose-800" : "text-amber-800")}>
          System Readiness — {secWarnings.length} {secWarnings.length === 1 ? "Alert" : "Alerts"}
        </span>
      </div>
      <ul className="space-y-1.5 pl-1">
        {secWarnings.map((w, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={cx(
              "mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-black uppercase tracking-wide",
              w.severity === "error"
                ? "bg-rose-600 text-white"
                : "bg-amber-500 text-white"
            )}>
              {w.severity ?? "warn"}
            </span>
            <span className={cx("text-[11px] leading-snug", hasError ? "text-rose-800" : "text-amber-800")}>
              <span className="font-bold">{w.code}</span> — {w.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconRevenue = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);
const IconExpenses = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
  </svg>
);
const IconProfit = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);
const IconCash = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);
const IconReceivable = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const IconPayable = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export function Dashboard() {
  const [summary, setSummary] = useState<Summary>({
    revenue: 0, expenses: 0, profit: 0, cashBalance: 0,
    receivables: 0, payables: 0,
    revenueSplit: { project: 0, academy: 0, event: 0 },
    departmentSummary: {
      academy: { revenue: 0, expenses: 0, profit: 0 },
      tech: { revenue: 0, expenses: 0, profit: 0 },
      marketing: { revenue: 0, expenses: 0, profit: 0 },
    },
  });
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [validateData, setValidateData] = useState<ValidateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const token = getStoredToken();
      if (!token) { setError("Not authenticated"); setLoading(false); return; }
      setLoading(true); setError(null);
      try {
        const [s, m, inv, v] = await Promise.allSettled([
          apiFetch<Summary>("/dashboard/summary", { token }),
          apiFetch<MonthlyRow[]>("/dashboard/monthly", { token }),
          apiFetch<Invoice[]>("/invoices", { token }),
          apiFetch<ValidateResponse>("/system/validate", { token }),
        ]);
        if (!alive) return;
        if (s.status === "fulfilled") setSummary(s.value);
        if (m.status === "fulfilled") setMonthly(Array.isArray(m.value) ? m.value : []);
        if (inv.status === "fulfilled") setInvoices(Array.isArray(inv.value) ? inv.value.slice(0, 6) : []);
        if (v.status === "fulfilled") setValidateData(v.value);
        setLastUpdated(new Date());
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  const hasData = !loading && (
    summary.revenue !== 0 || summary.expenses !== 0 ||
    summary.cashBalance !== 0 || summary.receivables !== 0
  );

  const chartData = monthly.length > 0
    ? monthly.map((r) => ({ name: r.month, revenue: r.revenue, expenses: r.expenses }))
    : [{ name: "YTD", revenue: summary.revenue, expenses: summary.expenses }];

  const profitIsNeg = summary.profit < 0;
  const cashIsNeg = summary.cashBalance < 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top Bar ── */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                  FinanceOS
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  CFO Command Center
                </span>
              </div>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
                Executive Dashboard
              </h1>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Financial overview · India-GAAP · GST compliant ·{" "}
                {lastUpdated ? (
                  <span className="font-semibold text-slate-500">Updated {formatDateTime(lastUpdated)}</span>
                ) : (
                  <span className="font-semibold text-slate-500">Loading…</span>
                )}
              </p>
            </div>
            <div className="shrink-0 w-full max-w-xs">
              <FinancialYearWidget />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-inset ring-rose-200">
            <p className="text-sm font-semibold text-rose-700">{error}</p>
          </div>
        )}

        {/* ── Cash Warning ── */}
        {!loading && summary.warning && (
          <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
            <p className="text-sm font-semibold text-amber-800">{summary.warning}</p>
          </div>
        )}

        {/* ── System Readiness ── */}
        {!loading && validateData && (
          <AlertPanel warnings={validateData.warnings} />
        )}

        {/* ── Skeleton ── */}
        {loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && !hasData && !error && (
          <EmptyState
            title="No financial data yet"
            description="Create invoices and record expenses to populate this dashboard."
          />
        )}

        {/* ── Main Content ── */}
        {!loading && hasData && (
          <>
            {/* KPI Grid */}
            <section>
              <SectionLabel>Core Financial KPIs — Current Financial Year</SectionLabel>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard
                  label="Revenue"
                  value={summary.revenue}
                  sub="Earned this FY"
                  accent="bg-emerald-50 ring-emerald-200 text-emerald-700"
                  icon={<IconRevenue />}
                />
                <KpiCard
                  label="Expenses"
                  value={summary.expenses}
                  sub="Total outflows"
                  accent="bg-rose-50 ring-rose-200 text-rose-700"
                  icon={<IconExpenses />}
                />
                <KpiCard
                  label="Net Profit"
                  value={summary.profit}
                  sub={profitMargin(summary.revenue, summary.profit) + " margin"}
                  accent={profitIsNeg ? "bg-rose-50 ring-rose-200 text-rose-700" : "bg-indigo-50 ring-indigo-200 text-indigo-700"}
                  icon={<IconProfit />}
                  alert={profitIsNeg}
                />
                <KpiCard
                  label="Cash & Bank"
                  value={summary.cashBalance}
                  sub="GL balance"
                  accent={cashIsNeg ? "bg-rose-50 ring-rose-200 text-rose-700" : "bg-cyan-50 ring-cyan-200 text-cyan-700"}
                  icon={<IconCash />}
                  alert={cashIsNeg}
                />
                <KpiCard
                  label="Receivables"
                  value={summary.receivables}
                  sub="Accounts receivable"
                  accent="bg-amber-50 ring-amber-200 text-amber-700"
                  icon={<IconReceivable />}
                />
                <KpiCard
                  label="Payables"
                  value={summary.payables}
                  sub="Outstanding dues"
                  accent="bg-orange-50 ring-orange-200 text-orange-700"
                  icon={<IconPayable />}
                />
              </div>
            </section>

            {/* Revenue by Business Unit */}
            <section>
              <SectionLabel>Revenue Streams — Business Unit Breakdown</SectionLabel>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <BuCard
                  label="Projects"
                  revenue={summary.revenueSplit?.project ?? 0}
                  profit={(summary.departmentSummary?.tech?.profit ?? 0)}
                  tag="P"
                  accentBg="bg-emerald-100"
                  accentText="text-emerald-800"
                />
                <BuCard
                  label="Academy"
                  revenue={summary.revenueSplit?.academy ?? 0}
                  profit={summary.departmentSummary?.academy?.profit ?? 0}
                  tag="A"
                  accentBg="bg-cyan-100"
                  accentText="text-cyan-800"
                />
                <BuCard
                  label="Events"
                  revenue={summary.revenueSplit?.event ?? 0}
                  profit={summary.departmentSummary?.marketing?.profit ?? 0}
                  tag="E"
                  accentBg="bg-violet-100"
                  accentText="text-violet-800"
                />
              </div>
            </section>

            {/* Chart */}
            <section>
              <SectionLabel>Monthly Revenue vs Expenses</SectionLabel>
              <div className="rounded-xl bg-white p-6 ring-1 ring-inset ring-slate-200/70 shadow-sm">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800">Period Performance</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Month-on-month revenue & expenditure · hover for details</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 ring-1 ring-inset ring-slate-200">
                    Bar Chart
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v) => [fmt0(Number(v)), ""]}
                      labelFormatter={(l) => `Period: ${l}`}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 16, fontSize: 11 }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#059669" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#e11d48" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Recent Invoices */}
            <section>
              <SectionLabel>Recent Invoices</SectionLabel>
              <div className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200/70 shadow-sm">
                {invoices.length === 0 ? (
                  <div className="p-8">
                    <EmptyState title="No recent invoices" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Customer</th>
                          <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">Amount</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {invoices.map((inv) => {
                          const statusKey = (inv.status ?? "draft").toLowerCase();
                          return (
                            <tr key={inv._id} className="bg-white hover:bg-slate-50/60 transition-colors">
                              <td className="px-5 py-3.5 font-semibold text-slate-800">{inv.customer?.name ?? "—"}</td>
                              <td className="px-5 py-3.5 text-right tabular-nums font-bold text-slate-900">{fmt0(Number(inv.totalAmount || 0))}</td>
                              <td className="px-5 py-3.5">
                                <span className={cx(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset",
                                  STATUS_COLORS[statusKey] ?? STATUS_COLORS.draft
                                )}>
                                  {statusKey}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-[11px] text-slate-500">
                                {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("en-IN") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* Compliance Footer */}
            <footer className="rounded-xl bg-white p-5 ring-1 ring-inset ring-slate-200/70 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Compliance Signals</span>
                {[
                  { label: "GST Filing", ok: true },
                  { label: "TDS Compliance", ok: true },
                  { label: "Bank Reconciliation", ok: !validateData?.errors.length },
                  { label: "Audit Trail", ok: true },
                  { label: "E-Invoice", ok: true },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span className={cx("h-1.5 w-1.5 rounded-full", item.ok ? "bg-emerald-500" : "bg-amber-400")} />
                    <span className={cx("text-[11px] font-semibold", item.ok ? "text-slate-600" : "text-amber-600")}>{item.label}</span>
                  </div>
                ))}
                <span className="ml-auto text-[10px] text-slate-300">
                  Nexfern FinanceOS · India-GAAP · FY {new Date().getFullYear()}–{String(new Date().getFullYear() + 1).slice(2)}
                </span>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
