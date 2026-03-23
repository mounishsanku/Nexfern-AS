import * as React from "react";
import { apiFetch, getStoredToken, downloadGstReport, downloadCsv } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InlineSpinner } from "@/components/ui/Spinner";
import { VirtualizedTable, type VirtualTableColumn } from "@/components/VirtualizedTable";
import { nexfernCsvFilename } from "@/lib/exportFilename";
import { useToast } from "@/context/ToastContext";

// ─── Types ───────────────────────────────────────────────────────────────────

type TrialBalanceRow = {
  account: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

type TrialBalanceData = {
  accounts: TrialBalanceRow[];
  totals: { totalDebit: number; totalCredit: number };
};

type LedgerStatementRow = {
  _id: string;
  date: string | null;
  voucherNumber: string;
  voucherType: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
};

type LedgerData = {
  account: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  entries: LedgerStatementRow[];
};

type ProfitLossData = {
  revenue: number;
  expenses: number;
  profit: number;
};

type RevenueSplitData = {
  project: number;
  academy: number;
  event: number;
};

type BalanceSheetData = {
  assets: { cash: number; accountsReceivable: number; other: number; total: number };
  liabilities: { gstPayable: number; other: number; total: number };
  equity: { retainedEarnings: number; total: number };
  totals: { totalAssets: number; liabilitiesPlusEquity: number; balanced: boolean };
};

type CashFlowData = {
  openingBalance: number;
  inflow: number;
  outflow: number;
  closingBalance: number;
  operating?: { revenue: number; expenses: number };
};

type Tab = "trial-balance" | "profit-loss" | "balance-sheet" | "cash-flow";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionError({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">
      {msg}
    </div>
  );
}

function Spinner() {
  return (
    <div className="py-10 text-center text-sm font-semibold text-slate-500">
      Loading…
    </div>
  );
}

function Empty() {
  return (
    <div className="py-10 text-center text-sm font-semibold text-slate-400">
      No data available
    </div>
  );
}

const ExportButton = React.memo(function ExportButton({
  report,
  format,
}: {
  report: "gstr1" | "gstr3b";
  format: "json" | "csv";
}) {
  const { success } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      await downloadGstReport(report, format);
      success("Export completed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  const icons = {
    gstr1: { json: "📄", csv: "📊" },
    gstr3b: { json: "📄", csv: "📊" },
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="md"
        className="h-16 group flex flex-col gap-1.5 p-4 font-semibold shadow-lg transition-all duration-200 hover:shadow-xl justify-center items-center text-sm !min-h-0"
        variant="secondary"
        onClick={handleExport}
        disabled={loading}
        aria-busy={loading}
      >
        <span className="text-2xl transition-transform duration-200 group-hover:scale-110">
          {loading ? <InlineSpinner className="h-6 w-6 border-2" /> : icons[report][format]}
        </span>
        <span className="whitespace-nowrap">{loading ? "Exporting…" : `${report.toUpperCase()} ${format.toUpperCase()}`}</span>
      </Button>
      {error ? <span className="text-xs font-semibold text-red-600">{error}</span> : null}
    </div>
  );
});

function StatCard({
  label,
  value,
  color = "text-slate-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className={cx("mt-2 text-2xl font-extrabold", color)}>{fmt(value)}</div>
    </div>
  );
}

// ─── Ledger Drilldown Panel ───────────────────────────────────────────────────

function LedgerPanel({
  account,
  onClose,
}: {
  account: string;
  onClose: () => void;
}) {
  const { success } = useToast();
  const [data, setData] = React.useState<LedgerData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const ledgerColumns = React.useMemo((): VirtualTableColumn<LedgerStatementRow>[] => {
    return [
      {
        id: "date",
        header: "Date",
        width: "92px",
        cell: (e) => (
          <span className="text-slate-600">{e.date ? new Date(e.date).toLocaleDateString("en-IN") : "—"}</span>
        ),
      },
      {
        id: "voucher",
        header: "Voucher",
        width: "88px",
        cell: (e) => <span className="font-medium text-slate-800">{e.voucherNumber}</span>,
      },
      {
        id: "type",
        header: "Type",
        width: "72px",
        hideBelowMd: true,
        cell: (e) => <span className="capitalize text-slate-500">{e.voucherType}</span>,
      },
      {
        id: "narration",
        header: "Narration",
        width: "minmax(140px,1fr)",
        cell: (e) => <span className="line-clamp-2 text-slate-600">{e.narration}</span>,
      },
      {
        id: "debit",
        header: "Debit",
        align: "right",
        width: "118px",
        cell: (e) => (
          <span className="inline-block min-w-[5.5rem] rounded-md bg-rose-50 px-2 py-1.5 font-mono text-xs tabular-nums text-rose-900 ring-1 ring-rose-100">
            {e.debit > 0 ? fmt(e.debit) : "—"}
          </span>
        ),
      },
      {
        id: "credit",
        header: "Credit",
        align: "right",
        width: "118px",
        cell: (e) => (
          <span className="inline-block min-w-[5.5rem] rounded-md bg-emerald-50 px-2 py-1.5 font-mono text-xs tabular-nums text-emerald-900 ring-1 ring-emerald-100">
            {e.credit > 0 ? fmt(e.credit) : "—"}
          </span>
        ),
      },
      {
        id: "balance",
        header: "Balance",
        align: "right",
        width: "124px",
        cell: (e) => (
          <span
            className={cx(
              "font-mono text-sm font-bold tabular-nums",
              e.balance < 0 ? "text-red-600" : "text-slate-900",
            )}
          >
            {fmt(e.balance)}
          </span>
        ),
      },
    ];
  }, []);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always fetch fresh — read token directly so it's never stale
  React.useEffect(() => {
    const token = getStoredToken();
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);

    apiFetch<LedgerData>(`/reports/ledger/${encodeURIComponent(account)}`, { token })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load ledger"); setLoading(false); } });

    return () => { alive = false; };
  }, [account]);

  return (
    // Backdrop — click outside to close
    <div
      className={cx(
        "fixed inset-0 z-50 flex justify-end transition-colors duration-300",
        visible ? "bg-slate-900/40" : "bg-slate-900/0",
      )}
      onClick={handleClose}
    >
      {/* Panel — stop propagation so clicks inside don't close */}
      <div
        className={cx(
          "flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          visible ? "translate-x-0" : "translate-x-full",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Ledger Drilldown
            </div>
            <div className="mt-0.5 text-lg font-extrabold text-slate-900">{account}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={exporting || Boolean(error)}
              className="inline-flex items-center gap-2"
              aria-busy={exporting}
              onClick={() => {
                setExporting(true);
                const safe = account.replace(/[^\w.-]+/g, "_").slice(0, 80);
                downloadCsv(
                  `/reports/ledger/${encodeURIComponent(account)}/csv`,
                  nexfernCsvFilename(`ledger_${safe}`),
                )
                  .then(() => success("Export completed"))
                  .catch(() => {})
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? <InlineSpinner /> : null}
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              ✕ Close
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <Spinner />
          ) : error ? (
            <SectionError msg={error} />
          ) : !data || data.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-3xl">📒</div>
              <div className="mt-3 text-sm font-semibold text-slate-500">
                No entries found for <span className="text-slate-900">{account}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Entries appear here once vouchers are posted to this account.
              </div>
            </div>
          ) : (
            <>
              {/* Summary chips */}
              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                  <div className="text-xs font-semibold text-slate-500">Total Debit</div>
                  <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-slate-900">
                    {fmt(data.totalDebit)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                  <div className="text-xs font-semibold text-slate-500">Total Credit</div>
                  <div className="mt-1 font-mono text-base font-extrabold tabular-nums text-slate-900">
                    {fmt(data.totalCredit)}
                  </div>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 ring-1 ring-inset ring-primary/20">
                  <div className="text-xs font-semibold text-primary">Closing Balance</div>
                  <div
                    className={cx(
                      "mt-1 font-mono text-base font-extrabold tabular-nums",
                      data.balance < 0 ? "text-red-600" : "text-primary",
                    )}
                  >
                    {fmt(data.balance)}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
                <VirtualizedTable
                  rows={data.entries}
                  columns={ledgerColumns}
                  rowKey={(e) => e._id}
                  rowHeight={56}
                  maxHeight={480}
                  minTableWidth={960}
                  threshold={200}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-4 py-3 text-xs">
                  <span className="font-extrabold text-slate-700">Totals</span>
                  <div className="flex flex-wrap items-center gap-6 sm:gap-10">
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">Debit</div>
                      <div className="font-mono font-extrabold tabular-nums text-rose-900">{fmt(data.totalDebit)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">Credit</div>
                      <div className="font-mono font-extrabold tabular-nums text-emerald-900">{fmt(data.totalCredit)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">Balance</div>
                      <div
                        className={cx(
                          "font-mono text-sm font-extrabold tabular-nums",
                          data.balance < 0 ? "text-red-600" : "text-slate-900",
                        )}
                      >
                        {fmt(data.balance)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trial Balance Tab ────────────────────────────────────────────────────────

function TrialBalanceTab({ token }: { token: string }) {
  const { success } = useToast();
  const [data, setData] = React.useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [drillAccount, setDrillAccount] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const tbColumns = React.useMemo((): VirtualTableColumn<TrialBalanceRow>[] => {
    return [
      {
        id: "account",
        header: "Account",
        width: "minmax(200px,1fr)",
        cell: (row) => (
          <button
            type="button"
            className="text-left font-semibold text-primary hover:underline"
            onClick={() => setDrillAccount(row.account)}
          >
            {row.account}
          </button>
        ),
      },
      {
        id: "type",
        header: "Type",
        width: "80px",
        hideBelowMd: true,
        cell: (row) => <span className="capitalize text-slate-500">{row.type}</span>,
      },
      {
        id: "debit",
        header: "Debit (Dr)",
        align: "right",
        width: "112px",
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums sm:text-sm">{row.debit > 0 ? fmt(row.debit) : "—"}</span>
        ),
      },
      {
        id: "credit",
        header: "Credit (Cr)",
        align: "right",
        width: "112px",
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums sm:text-sm">{row.credit > 0 ? fmt(row.credit) : "—"}</span>
        ),
      },
      {
        id: "balance",
        header: "Balance",
        align: "right",
        width: "120px",
        cell: (row) => (
          <span
            className={cx(
              "font-mono text-sm font-bold tabular-nums",
              row.balance < 0 ? "text-red-600" : "text-slate-900",
            )}
          >
            {fmt(row.balance)}
          </span>
        ),
      },
    ];
  }, [setDrillAccount]);

  React.useEffect(() => {
    let alive = true;
    apiFetch<TrialBalanceData>("/reports/trial-balance", { token })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [token]);

  if (loading) return <Spinner />;
  if (error)   return <SectionError msg={error} />;
  if (!data || data.accounts.length === 0) return <Empty />;

  return (
    <>
      {drillAccount ? (
        <LedgerPanel
          key={drillAccount}
          account={drillAccount}
          onClose={() => setDrillAccount(null)}
        />
      ) : null}

      <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-500">
            Click any account row to drill into its ledger
          </div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={exporting}
            className="inline-flex items-center gap-2"
            aria-busy={exporting}
            onClick={() => {
              setExporting(true);
              downloadCsv("/reports/trial-balance/csv", nexfernCsvFilename("trial_balance"))
                .then(() => success("Export completed"))
                .catch(() => {})
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? <InlineSpinner /> : null}
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
        <VirtualizedTable
          rows={data.accounts}
          columns={tbColumns}
          rowKey={(row) => row.account}
          rowHeight={52}
          maxHeight={560}
          minTableWidth={900}
          threshold={200}
        />
        <div className="border-t border-slate-200 bg-slate-100 px-4 py-3 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-extrabold text-slate-800">Totals</span>
            <div className="flex flex-wrap gap-6 font-mono font-extrabold tabular-nums">
              <span>Dr {fmt(data.totals.totalDebit)}</span>
              <span>Cr {fmt(data.totals.totalCredit)}</span>
              <span className="text-slate-900">Net {fmt(data.totals.totalDebit - data.totals.totalCredit)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Deferred Revenue Recognition ─────────────────────────────────────────────

function DeferredRevenueRecognize({
  token,
  onRecognized,
}: {
  token: string;
  onRecognized?: () => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleRecognize() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{
        message?: string;
        recognized?: number;
        scheduleCount?: number;
        voucherId?: string;
      }>("/revenue/recognize", {
        method: "POST",
        token,
      });
      setMessage(
        res.recognized != null && res.recognized > 0
          ? `Recognized ₹${res.recognized.toLocaleString("en-IN")} from ${res.scheduleCount ?? 0} schedule(s)`
          : res.message ?? "No due schedules to recognize",
      );
      onRecognized?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to recognize revenue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-slate-900">
            Deferred Revenue
          </div>
          <div className="text-xs text-slate-500">
            Recognize due amounts: Dr Deferred Revenue, Cr Revenue
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleRecognize()}
          disabled={loading}
        >
          {loading ? "Recognizing…" : "Recognize Revenue"}
        </Button>
      </div>
      {message ? (
        <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 ring-1 ring-inset ring-green-200">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ─── Profit & Loss Tab ────────────────────────────────────────────────────────

function ProfitLossTab({ token }: { token: string }) {
  const [data, setData] = React.useState<ProfitLossData | null>(null);
  const [split, setSplit] = React.useState<RevenueSplitData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch<ProfitLossData>("/reports/profit-loss", { token }),
      apiFetch<RevenueSplitData>("/reports/revenue-split", { token }),
    ])
      .then(([d, s]) => { if (alive) { setData(d); setSplit(s); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [token]);

  if (loading) return <Spinner />;
  if (error)   return <SectionError msg={error} />;
  if (!data)   return <Empty />;

  const isProfit = data.profit >= 0;

  return (
    <div className="space-y-6">
      <DeferredRevenueRecognize token={token} onRecognized={() => { /* refresh handled by parent if needed */ }} />
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Revenue" value={data.revenue} color="text-green-600" />
        <StatCard label="Total Expenses" value={data.expenses} color="text-red-500" />
        <StatCard
          label={isProfit ? "Net Profit" : "Net Loss"}
          value={data.profit}
          color={isProfit ? "text-primary" : "text-red-600"}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Project Revenue" value={split?.project ?? 0} color="text-emerald-700" />
        <StatCard label="Academy Revenue" value={split?.academy ?? 0} color="text-cyan-700" />
        <StatCard label="Event Revenue" value={split?.event ?? 0} color="text-fuchsia-700" />
      </div>

      {/* P&L Statement */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="text-sm font-extrabold text-slate-900">
            Profit &amp; Loss Statement
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          <PLRow label="Revenue" value={data.revenue} bold />
          <PLRow label="Less: Expenses" value={-data.expenses} indent />
          <div className="flex items-center justify-between bg-slate-50 px-6 py-4">
            <span className="text-sm font-extrabold text-slate-900">
              {isProfit ? "Net Profit" : "Net Loss"}
            </span>
            <span
              className={cx(
                "text-base font-extrabold",
                isProfit ? "text-primary" : "text-red-600",
              )}
            >
              {fmt(data.profit)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PLRow({
  label,
  value,
  bold = false,
  indent = false,
}: {
  label: string;
  value: number;
  bold?: boolean;
  indent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <span
        className={cx(
          "text-sm text-slate-700",
          bold && "font-semibold",
          indent && "pl-4 text-slate-500",
        )}
      >
        {label}
      </span>
      <span
        className={cx(
          "text-sm",
          bold ? "font-semibold text-slate-900" : "font-semibold text-slate-700",
          value < 0 && "text-red-600",
        )}
      >
        {fmt(Math.abs(value))}
      </span>
    </div>
  );
}

// ─── Balance Sheet Tab ────────────────────────────────────────────────────────

function BalanceSheetTab({ token }: { token: string }) {
  const [data, setData] = React.useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    apiFetch<BalanceSheetData>("/reports/accounting-balance-sheet", { token })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [token]);

  if (loading) return <Spinner />;
  if (error)   return <SectionError msg={error} />;
  if (!data)   return <Empty />;

  return (
    <div className="space-y-6">
      {/* Equation check banner */}
      <div
        className={cx(
          "rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 ring-inset",
          data.totals.balanced
            ? "bg-green-50 text-green-700 ring-green-200"
            : "bg-red-50 text-red-700 ring-red-200",
        )}
      >
        {data.totals.balanced
          ? `✓ Balanced — Assets ${fmt(data.totals.totalAssets)} = Liabilities + Equity ${fmt(data.totals.liabilitiesPlusEquity)}`
          : `⚠ Out of balance — Assets ${fmt(data.totals.totalAssets)} ≠ Liabilities + Equity ${fmt(data.totals.liabilitiesPlusEquity)}`}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Assets */}
        <BSSection title="Assets">
          <BSRow label="Cash" value={data.assets.cash} />
          <BSRow label="Accounts Receivable" value={data.assets.accountsReceivable} />
          {data.assets.other !== 0 && <BSRow label="Other Assets" value={data.assets.other} />}
          <BSRow label="Total Assets" value={data.assets.total} total />
        </BSSection>

        {/* Liabilities + Equity */}
        <div className="space-y-4">
          <BSSection title="Liabilities">
            <BSRow label="GST Payable" value={data.liabilities.gstPayable} />
            {data.liabilities.other !== 0 && (
              <BSRow label="Other Liabilities" value={data.liabilities.other} />
            )}
            <BSRow label="Total Liabilities" value={data.liabilities.total} total />
          </BSSection>

          <BSSection title="Equity">
            <BSRow label="Retained Earnings" value={data.equity.retainedEarnings} />
            <BSRow label="Total Equity" value={data.equity.total} total />
          </BSSection>
        </div>
      </div>
    </div>
  );
}

function BSSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
        <div className="text-sm font-extrabold text-slate-900">{title}</div>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function BSRow({
  label,
  value,
  total = false,
}: {
  label: string;
  value: number;
  total?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between px-6 py-3",
        total && "bg-slate-50",
      )}
    >
      <span
        className={cx(
          "text-sm text-slate-700",
          total && "font-extrabold text-slate-900",
        )}
      >
        {label}
      </span>
      <span
        className={cx(
          "text-sm font-semibold",
          total ? "font-extrabold text-slate-900" : "text-slate-700",
          value < 0 && "text-red-600",
        )}
      >
        {fmt(value)}
      </span>
    </div>
  );
}

// ─── Cash Flow Tab ────────────────────────────────────────────────────────────

function CashFlowTab({ token }: { token: string }) {
  const [data, setData] = React.useState<CashFlowData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    apiFetch<CashFlowData>("/reports/cash-flow", { token })
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [token]);

  if (loading) return <Spinner />;
  if (error)   return <SectionError msg={error} />;
  if (!data)   return <Empty />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Opening Balance" value={data.openingBalance} color="text-slate-900" />
        <StatCard label="Cash Inflow" value={data.inflow} color="text-green-600" />
        <StatCard label="Cash Outflow" value={data.outflow} color="text-red-500" />
        <StatCard label="Closing Balance" value={data.closingBalance} color="text-primary" />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="text-sm font-extrabold text-slate-900">Cash Flow Statement</div>
          <div className="text-xs text-slate-500 mt-1">
            Opening + Inflow - Outflow = Closing
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          <PLRow label="Opening Balance" value={data.openingBalance} bold />
          <PLRow label="Add: Cash Inflows" value={data.inflow} indent />
          <PLRow label="Less: Cash Outflows" value={-data.outflow} indent />
          <div className="flex items-center justify-between bg-slate-50 px-6 py-4">
            <span className="text-sm font-extrabold text-slate-900">Closing Balance</span>
            <span className="text-base font-extrabold text-primary">{fmt(data.closingBalance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "trial-balance", label: "Trial Balance" },
  { id: "profit-loss",   label: "Profit & Loss" },
  { id: "balance-sheet", label: "Balance Sheet" },
  { id: "cash-flow",     label: "Cash Flow" },
];

export function Reports() {
  const token = getStoredToken();
  const [activeTab, setActiveTab] = React.useState<Tab>("trial-balance");

  if (!token) {
    return (
      <Container className="py-10">
        <SectionError msg="Missing auth token. Please login again." />
      </Container>
    );
  }

  return (
    <Container className="py-10">
      {/* Page header */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-slate-500">Accounting</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
          Financial Reports
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Voucher-based double-entry reports. Click any account in Trial Balance to drill into its ledger.
        </p>

        {/* GST Export Section */}
        <div className="mb-8 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 p-6 ring-1 ring-inset ring-indigo-200">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">GST Returns Export</h2>
              <p className="text-sm text-slate-500 mt-1">Download GSTR-1 and GSTR-3B reports in JSON or CSV format</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <ExportButton report="gstr1" format="json" />
            <ExportButton report="gstr1" format="csv" />
            <ExportButton report="gstr3b" format="json" />
            <ExportButton report="gstr3b" format="csv" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/90 p-1.5 shadow-inner"
        role="tablist"
        aria-label="Report type"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cx(
              "min-w-[8rem] flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
              activeTab === tab.id
                ? "bg-white text-slate-900 shadow-md ring-1 ring-slate-200/90"
                : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "trial-balance" && <TrialBalanceTab token={token} />}
      {activeTab === "profit-loss"   && <ProfitLossTab   token={token} />}
      {activeTab === "balance-sheet" && <BalanceSheetTab token={token} />}
      {activeTab === "cash-flow"     && <CashFlowTab     token={token} />}
    </Container>
  );
}
