"use client";

import * as React from "react";
import { LedgerDrilldown } from "./LedgerDrilldown";

interface AccountRow {
  account: string;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceResponse {
  accounts: AccountRow[];
  totals: { totalDebit: number; totalCredit: number };
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function TrialBalance() {
  const [data, setData] = React.useState<TrialBalanceResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = React.useState<string | null>(null);

  React.useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${apiBase}/api/trial-balance`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TrialBalanceResponse>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      });
  }, []);

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        {/* Card header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Accounting
            </div>
            <h2 className="mt-0.5 text-lg font-extrabold tracking-tight text-slate-900">
              Trial Balance
            </h2>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Click a row to drill down
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-slate-500">
            <svg
              className="h-4 w-4 animate-spin text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.122 2.122M8.757 15.243l-2.121 2.121M18.364 18.364l-2.122-2.122M8.757 8.757 6.636 6.636"
              />
            </svg>
            Loading trial balance…
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="m-6 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-200">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && data && data.accounts.length === 0 && (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            No ledger entries found.
          </div>
        )}

        {/* Table */}
        {data && data.accounts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-3">Account</th>
                  <th className="px-4 py-3 text-right">Debit</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.accounts.map((row) => (
                  <tr
                    key={row.account}
                    onClick={() => setSelectedAccount(row.account)}
                    className="cursor-pointer transition-colors hover:bg-primary/5 active:bg-primary/10 group"
                    title={`View ledger entries for ${row.account}`}
                  >
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-primary group-hover:underline underline-offset-2">
                        {row.account}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-emerald-700">
                      {row.debit > 0 ? `₹${fmt(row.debit)}` : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-red-500">
                      {row.credit > 0 ? `₹${fmt(row.credit)}` : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={`font-extrabold ${
                          row.balance > 0
                            ? "text-emerald-700"
                            : row.balance < 0
                              ? "text-red-600"
                              : "text-slate-500"
                        }`}
                      >
                        {row.balance >= 0 ? "" : "− "}₹
                        {fmt(Math.abs(row.balance))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Grand totals footer */}
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                  <td className="px-6 py-3">Total</td>
                  <td className="px-4 py-3 text-right text-emerald-700">
                    ₹{fmt(data.totals.totalDebit)}
                  </td>
                  <td className="px-4 py-3 text-right text-red-500">
                    ₹{fmt(data.totals.totalCredit)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    ₹{fmt(data.totals.totalDebit - data.totals.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Drilldown panel */}
      {selectedAccount && (
        <LedgerDrilldown
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
        />
      )}
    </>
  );
}
