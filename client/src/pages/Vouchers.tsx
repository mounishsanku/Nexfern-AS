import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

type VoucherEntryRow = {
  _id: string;
  accountId: { _id: string; name: string } | null;
  debit: number;
  credit: number;
};

type VoucherRow = {
  _id: string;
  voucherNumber: string;
  date: string;
  type: string;
  narration?: string;
  isReversed?: boolean;
  reversedFrom?: string | null;
  reversedByVoucherId?: string | null;
  referenceType?: string | null;
  entries: VoucherEntryRow[];
};

type ListResponse = {
  total: number;
  page: number;
  limit: number;
  vouchers: VoucherRow[];
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function accountName(e: VoucherEntryRow) {
  return e.accountId?.name ?? "—";
}

export function Vouchers() {
  const token = getStoredToken();
  const role = typeof window !== "undefined" ? window.localStorage.getItem("role") : null;
  const isAdmin = role === "admin";

  const [rows, setRows] = React.useState<VoucherRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reversingId, setReversingId] = React.useState<string | null>(null);

  async function load() {
    if (!token) {
      setError("Missing auth token.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ListResponse>("/vouchers?limit=100", { token });
      setRows(Array.isArray(data.vouchers) ? data.vouchers : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load vouchers.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
  }, [token]);

  async function handleReverse(v: VoucherRow) {
    if (!token || !isAdmin) return;
    if (
      !window.confirm(
        `Create a reversing voucher for ${v.voucherNumber}? Debit and credit will be swapped; the original will be marked reversed.`,
      )
    ) {
      return;
    }
    setReversingId(v._id);
    setError(null);
    try {
      await apiFetch(`/vouchers/reverse/${v._id}`, { method: "POST", token });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reverse failed.");
    } finally {
      setReversingId(null);
    }
  }

  const canReverse = (v: VoucherRow) =>
    isAdmin && !v.isReversed && !v.reversedFrom;

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Vouchers</h1>
          <p className="mt-1 text-sm text-slate-600">
            Posted journal vouchers. Admins can post a reversal (debit ↔ credit) without deleting the original.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-soft">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Voucher</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Lines</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No vouchers in this period.
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v._id} className="align-top hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{v.voucherNumber}</div>
                    {v.narration ? (
                      <div className="mt-0.5 max-w-xs text-xs text-slate-500 line-clamp-2">{v.narration}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {v.date ? new Date(v.date).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">{v.type}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {v.reversedFrom ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          Reversal
                        </span>
                      ) : null}
                      {v.isReversed ? (
                        <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">
                          Reversed
                        </span>
                      ) : null}
                      {!v.reversedFrom && !v.isReversed ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Posted
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <ul className="max-w-md space-y-0.5">
                      {(v.entries ?? []).slice(0, 4).map((e) => (
                        <li key={e._id} className="flex justify-between gap-2">
                          <span className="truncate">{accountName(e)}</span>
                          <span className="shrink-0 whitespace-nowrap text-slate-500">
                            {e.debit > 0 ? `Dr ${fmt(e.debit)}` : `Cr ${fmt(e.credit)}`}
                          </span>
                        </li>
                      ))}
                      {(v.entries?.length ?? 0) > 4 ? (
                        <li className="text-slate-400">+{v.entries!.length - 4} more…</li>
                      ) : null}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canReverse(v) ? (
                      <Button
                        variant="secondary"
                        className="text-sm"
                        disabled={reversingId === v._id}
                        onClick={() => void handleReverse(v)}
                      >
                        {reversingId === v._id ? "Reversing…" : "Reverse"}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">{isAdmin ? "—" : "Admin only"}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Container>
  );
}
