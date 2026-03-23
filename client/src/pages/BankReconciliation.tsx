import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { inputClassName } from "@/components/ui/Input";
import { formatCurrency } from "@/lib/format";

type UploadRow = {
  date: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
};

type MatchRow = {
  sourceType: "payment" | "expense";
  confidenceScore: number;
  bankTransaction: {
    _id: string;
    date: string;
    description: string;
    amount: number;
    type: "credit" | "debit";
    isMatched: boolean;
    matchedBy?: string | null;
    matchedAt?: string | null;
  };
  payment: {
    _id: string;
    date: string;
    amount: number;
    matched: boolean;
  } | null;
  expense?: {
    _id: string;
    date: string;
    amount: number;
    matched: boolean;
    title?: string;
  } | null;
};

type ReconcileResponse = {
  summary: {
    totalBankAmount: number;
    matchedAmount: number;
    unmatchedAmount: number;
    difference: number;
    ledgerBalance: number;
    bankBalance: number;
    balanceDifference: number;
  };
  matched: MatchRow[];
  unmatched: Array<{
    _id: string;
    date: string;
    description: string;
    amount: number;
    type: "credit" | "debit";
    isMatched: boolean;
  }>;
};

function parseDay(s: string): number {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.setHours(0, 0, 0, 0);
}

export function BankReconciliation() {
  const token = getStoredToken();
  const [payload, setPayload] = React.useState(
    '[{"date":"2026-03-20","description":"NEFT CREDIT","amount":1200,"type":"credit"}]',
  );
  const [busy, setBusy] = React.useState(false);
  const [data, setData] = React.useState<ReconcileResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [filterFrom, setFilterFrom] = React.useState("");
  const [filterTo, setFilterTo] = React.useState("");
  const [matchTab, setMatchTab] = React.useState<"all" | "matched" | "unmatched">("all");

  async function upload() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const rows = JSON.parse(payload) as UploadRow[];
      await apiFetch("/bank/upload", {
        method: "POST",
        token,
        body: JSON.stringify(rows),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<ReconcileResponse>("/bank/reconcile", { token });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  }

  async function unmatch(bankTransactionId: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/bank/unmatch", {
        method: "POST",
        token,
        body: JSON.stringify({ bankTransactionId }),
      });
      await reconcile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unmatch failed");
    } finally {
      setBusy(false);
    }
  }

  const fromT = filterFrom ? parseDay(filterFrom) : null;
  const toT = filterTo ? parseDay(filterTo) : null;

  const filteredMatched = React.useMemo(() => {
    const rows = data?.matched ?? [];
    return rows.filter((row) => {
      const t = parseDay(row.bankTransaction.date);
      if (fromT && t && t < fromT) return false;
      if (toT && t && t > toT) return false;
      return true;
    });
  }, [data?.matched, fromT, toT]);

  const filteredUnmatched = React.useMemo(() => {
    const rows = data?.unmatched ?? [];
    return rows.filter((row) => {
      const t = parseDay(row.date);
      if (fromT && t && t < fromT) return false;
      if (toT && t && t > toT) return false;
      return true;
    });
  }, [data?.unmatched, fromT, toT]);

  const showMatched = matchTab === "all" || matchTab === "matched";
  const showUnmatched = matchTab === "all" || matchTab === "unmatched";

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Bank reconciliation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload statement rows and run auto-matching against payments and expenses.
      </p>

      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Card padding="sm" className="!p-4 sm:col-span-2 lg:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bank total</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">
            {formatCurrency(data?.summary.totalBankAmount ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4 ring-emerald-200/80 bg-emerald-50/40">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Matched</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-emerald-800">
            {formatCurrency(data?.summary.matchedAmount ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4 ring-amber-200/80 bg-amber-50/40">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">Unmatched</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-amber-900">
            {formatCurrency(data?.summary.unmatchedAmount ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Difference</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-red-700">
            {formatCurrency(data?.summary.difference ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4 sm:col-span-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Book (cash + bank)</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">
            {formatCurrency(data?.summary.ledgerBalance ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4 sm:col-span-2 lg:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bank balance</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">
            {formatCurrency(data?.summary.bankBalance ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
        <Card padding="sm" className="!p-4 sm:col-span-2 lg:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bank vs book</div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-red-700">
            {formatCurrency(data?.summary.balanceDifference ?? 0, { maximumFractionDigits: 0 })}
          </div>
        </Card>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Statement JSON</div>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className="mt-2 h-28 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs text-slate-800"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={upload} disabled={busy}>
            Upload
          </Button>
          <Button variant="primary" onClick={reconcile} disabled={busy}>
            {busy ? "Working…" : "Run reconcile"}
          </Button>
        </div>
      </div>

      {data ? (
        <div className="mt-6 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">View</div>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">From</span>
              <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className={inputClassName} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">To</span>
              <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className={inputClassName} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">Rows</span>
              <select
                value={matchTab}
                onChange={(e) => setMatchTab(e.target.value as typeof matchTab)}
                className={inputClassName}
              >
                <option value="all">All</option>
                <option value="matched">Matched only</option>
                <option value="unmatched">Unmatched only</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" type="button" onClick={() => { setFilterFrom(""); setFilterTo(""); setMatchTab("all"); }}>
                Reset
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={
          matchTab === "all"
            ? "mt-6 grid gap-4 md:grid-cols-2"
            : "mt-6 grid grid-cols-1 gap-4"
        }
      >
        {showMatched ? (
          <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Matched</div>
            <p className="mt-0.5 text-xs text-slate-500">Green highlight = reconciled to a payment or expense.</p>
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto text-sm">
              {filteredMatched.length === 0 ? (
                <EmptyState title="No matched rows" />
              ) : (
                filteredMatched.map((row) => (
                  <div
                    key={row.bankTransaction._id}
                    className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-3 shadow-sm ring-1 ring-emerald-100"
                  >
                    <div className="font-semibold text-emerald-950">{row.bankTransaction.description}</div>
                    <div className="mt-1 tabular-nums text-emerald-900">
                      {formatCurrency(row.bankTransaction.amount, { maximumFractionDigits: 2 })} · {row.bankTransaction.type}
                    </div>
                    <div className="mt-2 text-xs text-emerald-800">
                      → {row.sourceType === "payment" ? `Payment ${row.payment?._id?.slice(-6)}` : `Expense ${row.expense?._id?.slice(-6)}`}
                      <span className="ml-2 inline-block rounded-md bg-white/80 px-2 py-0.5 font-semibold text-slate-700">
                        score {row.confidenceScore}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-emerald-800/90">
                      {row.bankTransaction.matchedBy ?? "—"} ·{" "}
                      {row.bankTransaction.matchedAt ? new Date(row.bankTransaction.matchedAt).toLocaleString("en-IN") : "—"}
                    </div>
                    <div className="mt-2">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => unmatch(row.bankTransaction._id)}>
                        Unmatch
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {showUnmatched ? (
          <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Unmatched</div>
            <p className="mt-0.5 text-xs text-slate-500">Amber = still open on the bank side.</p>
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto text-sm">
              {filteredUnmatched.length === 0 ? (
                <EmptyState title="No unmatched rows" />
              ) : (
                filteredUnmatched.map((row) => (
                  <div
                    key={row._id}
                    className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 ring-1 ring-amber-100"
                  >
                    <div className="font-semibold text-amber-950">{row.description}</div>
                    <div className="mt-1 tabular-nums text-amber-950">
                      {formatCurrency(row.amount, { maximumFractionDigits: 2 })} ({row.type})
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Container>
  );
}
