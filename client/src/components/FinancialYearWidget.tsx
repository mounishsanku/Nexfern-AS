import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";

type FY = {
  _id: string;
  name: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  closedAt: string | null;
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function FinancialYearWidget() {
  const token = getStoredToken();
  const role  = typeof window !== "undefined" ? window.localStorage.getItem("role") : null;

  const [years, setYears]       = React.useState<FY[]>([]);
  const [closing, setClosing]   = React.useState(false);
  const [error, setError]       = React.useState<string | null>(null);
  const [confirm, setConfirm]   = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    apiFetch<FY[]>("/financial-year", { token })
      .then(setYears)
      .catch(() => {}); // non-fatal
  }, [token]);

  const active = years.find((y) => !y.isClosed) ?? null;
  const closed = years.filter((y) => y.isClosed).sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
  );

  async function handleClose() {
    if (!active || !token) return;
    setClosing(true);
    setError(null);
    try {
      const updated = await apiFetch<FY>(`/financial-year/close/${active._id}`, {
        method: "POST",
        token,
      });
      setYears((prev) => prev.map((y) => y._id === updated._id ? updated : y));
      setConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close year");
    } finally {
      setClosing(false);
    }
  }

  if (years.length === 0) return null;

  return (
    <div className="rounded-xl bg-white p-5 shadow ring-1 ring-inset ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-extrabold text-slate-900">Financial Year</span>
        {active ? (
          <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-200">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
            All Closed
          </span>
        )}
      </div>

      {active && (
        <div className="mb-4">
          <div className="text-lg font-extrabold text-slate-900">{active.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {fmt(active.startDate)} — {fmt(active.endDate)}
          </div>

          {role === "admin" && (
            <div className="mt-3">
              {!confirm ? (
                <button
                  type="button"
                  onClick={() => setConfirm(true)}
                  className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100 transition-colors"
                >
                  Close Year
                </button>
              ) : (
                <div className="rounded-xl bg-red-50 p-3 ring-1 ring-inset ring-red-200">
                  <p className="mb-2 text-xs font-semibold text-red-700">
                    Close <strong>{active.name}</strong>? This locks all entries. Cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={closing}
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {closing ? "Closing…" : "Confirm Close"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirm(false); setError(null); }}
                      className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {closed.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Closed Years
          </div>
          <div className="space-y-1">
            {closed.slice(0, 3).map((y) => (
              <div key={y._id} className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{y.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                  Closed {y.closedAt ? fmt(y.closedAt) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
