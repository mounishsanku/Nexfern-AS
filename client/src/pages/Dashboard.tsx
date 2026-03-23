import { useEffect, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, getStoredToken } from "@/api";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Skeleton } from "@/components/ui/Skeleton";
import { FinancialYearWidget } from "@/components/FinancialYearWidget";
import { formatCurrency, formatDateTime } from "@/lib/format";

type Invoice = {
  _id: string;
  customer?: { name?: string } | null;
  totalAmount?: number;
  status?: string;
  createdAt?: string;
};

type Summary = {
  revenue: number;
  expenses: number;
  profit: number;
  cashBalance: number;
  receivables: number;
  payables: number;
  operationalCashBank?: number;
  negativeCashDetected?: boolean;
  warning?: string | null;
  revenueSplit?: {
    project: number;
    academy: number;
    event: number;
  };
  departmentSummary?: {
    academy: { revenue: number; expenses: number; profit: number };
    tech: { revenue: number; expenses: number; profit: number };
    marketing: { revenue: number; expenses: number; profit: number };
  };
};

type MonthlyRow = {
  month: string;
  year?: number;
  monthKey?: string;
  revenue: number;
  expenses: number;
};

function IconBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${className}`}
    >
      {children}
    </div>
  );
}

function MetricCard({
  title,
  value,
  colorClass,
  sub,
  icon,
}: {
  title: string;
  value: number;
  colorClass: string;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col justify-between rounded-2xl bg-white p-5 shadow-soft ring-1 ring-inset ring-slate-200/60">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
        {icon}
      </div>
      <div>
        <p className={`text-2xl font-extrabold tracking-tight tabular-nums ${colorClass}`}>
          {formatCurrency(value, { maximumFractionDigits: 0 })}
        </p>
        {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [summary, setSummary] = useState<Summary>({
    revenue: 0,
    expenses: 0,
    profit: 0,
    cashBalance: 0,
    receivables: 0,
    payables: 0,
    revenueSplit: { project: 0, academy: 0, event: 0 },
    departmentSummary: {
      academy: { revenue: 0, expenses: 0, profit: 0 },
      tech: { revenue: 0, expenses: 0, profit: 0 },
      marketing: { revenue: 0, expenses: 0, profit: 0 },
    },
  });
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;

    async function fetchData() {
      const token = getStoredToken();
      if (!token) {
        setError("User not logged in");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [summaryRes, monthlyRes, invRes] = await Promise.allSettled([
          apiFetch<Summary>("/dashboard/summary", { token }),
          apiFetch<MonthlyRow[]>("/dashboard/monthly", { token }),
          apiFetch<Invoice[]>("/invoices", { token }),
        ]);

        if (!alive) return;

        if (summaryRes.status === "fulfilled") setSummary(summaryRes.value);
        if (monthlyRes.status === "fulfilled")
          setMonthly(Array.isArray(monthlyRes.value) ? monthlyRes.value : []);
        if (invRes.status === "fulfilled")
          setInvoices(Array.isArray(invRes.value) ? invRes.value.slice(0, 5) : []);

        setLastUpdated(new Date());
      } catch (err) {
        if (alive)
          setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void fetchData();
    return () => {
      alive = false;
    };
  }, []);

  const hasData =
    !loading &&
    (summary.revenue !== 0 ||
      summary.expenses !== 0 ||
      summary.profit !== 0 ||
      summary.cashBalance !== 0 ||
      summary.receivables !== 0 ||
      summary.payables !== 0);

  const chartData =
    monthly.length > 0
      ? monthly.map((r) => ({
          name: r.month,
          revenue: r.revenue,
          expenses: r.expenses,
          profit: r.revenue - r.expenses,
        }))
      : [
          {
            name: "YTD",
            revenue: summary.revenue,
            expenses: summary.expenses,
            profit: summary.profit,
          },
        ];

  return (
    <Container className="py-8 sm:py-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">CFO Dashboard</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            Real-time financial insights
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Key metrics · Active financial year ·{" "}
            <span className="font-semibold text-slate-700">
              Last updated {lastUpdated ? formatDateTime(lastUpdated) : "—"}
            </span>
          </p>
        </div>
        <div className="w-full max-w-sm shrink-0 lg:self-auto">
          <FinancialYearWidget />
        </div>
      </div>

      {loading && (
        <div className="mt-8 space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[300px] w-full rounded-2xl" />
        </div>
      )}

      {error ? (
        <div className="mt-6">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      {!loading && summary.warning ? (
        <div
          className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900 ring-1 ring-inset ring-amber-200"
          role="status"
        >
          {summary.warning}
        </div>
      ) : null}

      {!loading && !hasData && !error ? (
        <div className="mt-8">
          <EmptyState
            title="No financial data available"
            description="Create invoices and record expenses to populate your dashboard."
          />
        </div>
      ) : null}

      {!loading && hasData ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              title="Revenue"
              value={summary.revenue}
              colorClass="text-emerald-600"
              sub="Revenue accounts"
              icon={
                <IconBox className="bg-emerald-50 text-emerald-600 ring-emerald-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </IconBox>
              }
            />
            <MetricCard
              title="Expenses"
              value={summary.expenses}
              colorClass="text-rose-500"
              sub="Expense accounts"
              icon={
                <IconBox className="bg-rose-50 text-rose-600 ring-rose-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  </svg>
                </IconBox>
              }
            />
            <MetricCard
              title="Profit"
              value={summary.profit}
              colorClass={summary.profit >= 0 ? "text-emerald-600" : "text-rose-600"}
              sub={summary.profit >= 0 ? "Net profit" : "Net loss"}
              icon={
                <IconBox className="bg-indigo-50 text-indigo-600 ring-indigo-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </IconBox>
              }
            />
            <MetricCard
              title="Cash"
              value={summary.cashBalance}
              colorClass="text-indigo-600"
              sub="Cash + Bank (GL)"
              icon={
                <IconBox className="bg-indigo-50 text-indigo-600 ring-indigo-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </IconBox>
              }
            />
            <MetricCard
              title="Receivables"
              value={summary.receivables}
              colorClass="text-amber-600"
              sub="Accounts Receivable"
              icon={
                <IconBox className="bg-amber-50 text-amber-600 ring-amber-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </IconBox>
              }
            />
            <MetricCard
              title="Payables"
              value={summary.payables}
              colorClass="text-orange-600"
              sub="Liabilities"
              icon={
                <IconBox className="bg-orange-50 text-orange-600 ring-orange-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </IconBox>
              }
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Project Revenue"
              value={summary.revenueSplit?.project ?? 0}
              colorClass="text-emerald-700"
              sub="Milestone / client projects"
              icon={
                <IconBox className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                  <span className="text-xs font-black">P</span>
                </IconBox>
              }
            />
            <MetricCard
              title="Academy Revenue"
              value={summary.revenueSplit?.academy ?? 0}
              colorClass="text-cyan-700"
              sub="Batches / fees"
              icon={
                <IconBox className="bg-cyan-50 text-cyan-700 ring-cyan-200">
                  <span className="text-xs font-black">A</span>
                </IconBox>
              }
            />
            <MetricCard
              title="Event Revenue"
              value={summary.revenueSplit?.event ?? 0}
              colorClass="text-fuchsia-700"
              sub="Ticket sales"
              icon={
                <IconBox className="bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200">
                  <span className="text-xs font-black">E</span>
                </IconBox>
              }
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              title="Academy Profit"
              value={summary.departmentSummary?.academy?.profit ?? 0}
              colorClass="text-cyan-700"
              sub={`Revenue ${formatCurrency(summary.departmentSummary?.academy?.revenue ?? 0, { maximumFractionDigits: 0 })}`}
              icon={<IconBox className="bg-cyan-50 text-cyan-700 ring-cyan-200"><span className="text-xs font-black">A</span></IconBox>}
            />
            <MetricCard
              title="Tech Profit"
              value={summary.departmentSummary?.tech?.profit ?? 0}
              colorClass="text-indigo-700"
              sub={`Revenue ${formatCurrency(summary.departmentSummary?.tech?.revenue ?? 0, { maximumFractionDigits: 0 })}`}
              icon={<IconBox className="bg-indigo-50 text-indigo-700 ring-indigo-200"><span className="text-xs font-black">T</span></IconBox>}
            />
            <MetricCard
              title="Marketing Profit"
              value={summary.departmentSummary?.marketing?.profit ?? 0}
              colorClass="text-pink-700"
              sub={`Revenue ${formatCurrency(summary.departmentSummary?.marketing?.revenue ?? 0, { maximumFractionDigits: 0 })}`}
              icon={<IconBox className="bg-pink-50 text-pink-700 ring-pink-200"><span className="text-xs font-black">M</span></IconBox>}
            />
          </div>

          <Card className="mt-8 overflow-hidden p-0">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-sm font-extrabold text-slate-900">Monthly revenue vs expenses</h2>
              <p className="mt-0.5 text-xs text-slate-500">Per-month breakdown · hover bars for tooltips</p>
            </div>
            <div className="p-6">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v) => [formatCurrency(Number(v || 0)), ""]}
                    labelFormatter={(l) => `Period: ${l}`}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 16 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#e11d48" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mt-8 overflow-hidden p-0">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-sm font-extrabold text-slate-900">Recent invoices</h2>
            </div>
            {invoices.length === 0 ? (
              <div className="px-6 py-8">
                <EmptyState title="No recent invoices" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Total
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv) => (
                      <tr key={inv._id} className="bg-white even:bg-slate-50/50">
                        <td className="px-6 py-4 font-semibold text-slate-900">
                          {inv.customer?.name ?? "—"}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums font-semibold text-slate-800">
                          {formatCurrency(Number(inv.totalAmount || 0))}
                        </td>
                        <td className="px-6 py-4 text-slate-700">
                          {String(inv.status || "").toUpperCase()}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {inv.createdAt
                            ? new Date(inv.createdAt).toLocaleDateString("en-IN")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </Container>
  );
}
