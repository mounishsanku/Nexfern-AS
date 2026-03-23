"use client";

import * as React from "react";

/** Shape from GET /api/reports/ledger/:account (VoucherEntry-based) */
interface LedgerRow {
  _id: string;
  date: string | null;
  voucherNumber: string;
  voucherType: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

interface DrilldownData {
  account: string;
  openingBalance?: number;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  entries: LedgerRow[];
}

interface LedgerDrilldownProps {
  account: string;
  onClose: () => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function LedgerDrilldown({ account, onClose }: LedgerDrilldownProps) {
  const [data, setData] = React.useState<DrilldownData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${apiBase}/api/reports/ledger/${encodeURIComponent(account)}`, {
      credentials: "include",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DrilldownData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      });
  }, [account]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Ledger entries for ${account}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Account Ledger
            </p>
            <h2 className="mt-0.5 text-lg font-extrabold tracking-tight text-slate-900">
              {account}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-3 gap-3 border-b border-slate-200 bg-white px-6 py-4">
            {[
              { label: "Total Debit", value: data.totalDebit, color: "text-emerald-600" },
              { label: "Total Credit", value: data.totalCredit, color: "text-red-500" },
              {
                label: "Balance",
                value: data.balance,
                color: data.balance >= 0 ? "text-emerald-700" : "text-red-600",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200"
              >
                <div className="text-xs font-semibold text-slate-500">{c.label}</div>
                <div className={`mt-1 text-base font-extrabold ${c.color}`}>₹{fmt(c.value)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">
              Loading entries…
            </div>
          )}

          {error && (
            <div className="m-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
              Failed to load: {error}
            </div>
          )}

          {data && data.entries.length === 0 && (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">
              No entries found for this account.
            </div>
          )}

          {data && data.entries.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white ring-1 ring-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-4 py-3">Voucher</th>
                  <th className="px-4 py-3 text-right">Debit</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map((entry) => (
                  <tr key={entry._id} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-700">
                      {entry.date
                        ? new Date(entry.date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{entry.voucherNumber}</div>
                      <div className="text-xs text-slate-500">{entry.narration}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {entry.debit > 0 ? `₹${fmt(entry.debit)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {entry.credit > 0 ? `₹${fmt(entry.credit)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                      ₹{fmt(entry.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}
