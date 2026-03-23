import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { TableWrap, Table, THead, Th, TBody, Td } from "@/components/ui/Table";
import { getStoredRole } from "@/components/RoleProtectedRoute";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/context/ToastContext";

type FinancialYear = {
  _id: string;
  name: string;
  startDate: string;
  endDate: string;
  isClosed?: boolean;
};

type AccountRow = {
  _id: string;
  name: string;
  type: string;
};

type OpeningBalanceDoc = {
  _id: string;
  accountId: AccountRow | string;
  financialYearId: string;
  debit?: number;
  credit?: number;
  debitAmount?: number;
  creditAmount?: number;
  amount?: number;
};

const INPUT =
  "h-9 w-full min-w-[6rem] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function accountIdOf(pop: OpeningBalanceDoc): string {
  const a = pop.accountId;
  return typeof a === "object" && a && "_id" in a ? String(a._id) : String(a);
}

function debitCreditFromDoc(ob: OpeningBalanceDoc): { debit: number; credit: number } {
  const d = Number(ob.debit ?? ob.debitAmount) || 0;
  const c = Number(ob.credit ?? ob.creditAmount) || 0;
  return { debit: d, credit: c };
}

export function OpeningBalances() {
  const { success: toastOk } = useToast();
  const token = getStoredToken();
  const role = getStoredRole();
  const canSave = role === "admin";

  const [years, setYears] = React.useState<FinancialYear[]>([]);
  const [fyId, setFyId] = React.useState("");
  const [accounts, setAccounts] = React.useState<AccountRow[]>([]);
  const [debitByAccount, setDebitByAccount] = React.useState<Record<string, string>>({});
  const [creditByAccount, setCreditByAccount] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  /** Accounts that had a non-zero opening balance from the server (used to send explicit zeros on clear). */
  const hadServerOpeningRef = React.useRef<Record<string, boolean>>({});

  const selectedYear = years.find((y) => y._id === fyId);
  const fyLocked = Boolean(selectedYear?.isClosed);

  async function loadYears() {
    if (!token) return;
    const list = await apiFetch<FinancialYear[]>("/financial-year", { token });
    const arr = Array.isArray(list) ? list : [];
    setYears(arr);
    if (!fyId && arr.length) {
      const open = arr.find((y) => !y.isClosed);
      setFyId((open ?? arr[0])._id);
    }
  }

  async function loadAccounts() {
    if (!token) return;
    const list = await apiFetch<AccountRow[]>("/accounts", { token });
    setAccounts(Array.isArray(list) ? list : []);
  }

  async function loadBalancesForFy(id: string) {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      const balances = await apiFetch<OpeningBalanceDoc[]>(`/opening-balances?financialYearId=${encodeURIComponent(id)}`, {
        token,
      });
      const dMap: Record<string, string> = {};
      const cMap: Record<string, string> = {};
      for (const a of accounts) {
        dMap[a._id] = "";
        cMap[a._id] = "";
      }
      const had: Record<string, boolean> = {};
      for (const ob of Array.isArray(balances) ? balances : []) {
        const aid = accountIdOf(ob);
        const { debit, credit } = debitCreditFromDoc(ob);
        dMap[aid] = debit > 0 ? String(debit) : "";
        cMap[aid] = credit > 0 ? String(credit) : "";
        had[aid] = debit > 0 || credit > 0;
      }
      hadServerOpeningRef.current = had;
      setDebitByAccount(dMap);
      setCreditByAccount(cMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opening balances");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadYears();
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  React.useEffect(() => {
    if (accounts.length && fyId) void loadBalancesForFy(fyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId, accounts.length]);

  function setDebit(aid: string, v: string) {
    setDebitByAccount((m) => ({ ...m, [aid]: v }));
    if (Number(v) > 0) setCreditByAccount((m) => ({ ...m, [aid]: "" }));
  }

  function setCredit(aid: string, v: string) {
    setCreditByAccount((m) => ({ ...m, [aid]: v }));
    if (Number(v) > 0) setDebitByAccount((m) => ({ ...m, [aid]: "" }));
  }

  async function onSave() {
    if (!token || !fyId || !canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const items: Array<{ accountId: string; debit: number; credit: number }> = [];
      for (const a of accounts) {
        const accountId = a._id;
        const dr = Math.max(0, Number(debitByAccount[accountId]) || 0);
        const cr = Math.max(0, Number(creditByAccount[accountId]) || 0);
        if (dr > 0 && cr > 0) {
          setError(`Account "${a.name}": enter either debit or credit, not both.`);
          setSaving(false);
          return;
        }
        const hadOpening = Boolean(hadServerOpeningRef.current[accountId]);
        if (dr > 0 || cr > 0) {
          items.push({ accountId, debit: dr, credit: cr });
        } else if (hadOpening) {
          items.push({ accountId, debit: 0, credit: 0 });
        }
      }
      await apiFetch("/opening-balances", {
        method: "POST",
        token,
        body: JSON.stringify({ financialYearId: fyId, items }),
      });
      setSuccess("Opening balances saved.");
      toastOk("Opening balances saved.");
      await loadBalancesForFy(fyId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code ?? "") : "";
      setError(code ? `${msg} (${code})` : msg);
    } finally {
      setSaving(false);
    }
  }

  const sortedAccounts = React.useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );

  return (
    <Container className="py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">Accounting</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Opening balances</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Opening balances affect trial balance, ledger, balance sheet, dashboard, and cash flow for the selected
            financial year. Enter either a debit or a credit per account (not both). If none is set, the account
            starts at zero for that year.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <label className="grid gap-1 text-right">
            <span className="text-xs font-semibold text-slate-500">Financial year</span>
            <select
              value={fyId}
              onChange={(e) => setFyId(e.target.value)}
              className="h-11 min-w-[12rem] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-soft"
            >
              {years.map((y) => (
                <option key={y._id} value={y._id}>
                  {y.name}
                  {y.isClosed ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </label>
          {canSave ? (
            <Button
              variant="primary"
              className="shadow-soft-lg"
              disabled={saving || !fyId || fyLocked || loading}
              onClick={() => void onSave()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <p className="text-xs font-semibold text-slate-500">View only — only an admin can save opening balances.</p>
          )}
        </div>
      </div>

      {fyLocked ? (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
          This financial year is closed. Opening balances cannot be changed (FY_LOCKED).
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}
      {success ? (
        <div className="mt-4 rounded-2xl bg-green-50 p-4 text-sm font-semibold text-green-700 ring-1 ring-inset ring-green-200">
          {success}
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="text-sm font-semibold text-slate-700">Accounts</div>
          {loading ? <span className="text-xs text-slate-500">Loading…</span> : null}
        </div>
        <TableWrap className="max-h-[min(70vh,560px)] overflow-y-auto rounded-none border-t border-slate-100 ring-0">
          <Table zebra>
            <THead>
              <tr>
                <Th>Account</Th>
                <Th>Type</Th>
                <Th align="right">Debit (₹)</Th>
                <Th align="right">Credit (₹)</Th>
              </tr>
            </THead>
            <TBody>
              {sortedAccounts.map((a) => (
                <tr key={a._id}>
                  <Td className="font-semibold text-slate-900">{a.name}</Td>
                  <Td className="text-xs capitalize text-slate-600">{a.type}</Td>
                  <Td align="right" className="!align-top">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      disabled={!canSave || fyLocked}
                      value={debitByAccount[a._id] ?? ""}
                      onChange={(e) => setDebit(a._id, e.target.value)}
                      className={INPUT}
                      placeholder="0"
                    />
                    {Number(debitByAccount[a._id]) > 0 ? (
                      <div className="mt-1 text-[11px] font-medium text-slate-400">
                        {formatCurrency(Number(debitByAccount[a._id]) || 0)}
                      </div>
                    ) : null}
                  </Td>
                  <Td align="right" className="!align-top">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      disabled={!canSave || fyLocked}
                      value={creditByAccount[a._id] ?? ""}
                      onChange={(e) => setCredit(a._id, e.target.value)}
                      className={INPUT}
                      placeholder="0"
                    />
                    {Number(creditByAccount[a._id]) > 0 ? (
                      <div className="mt-1 text-[11px] font-medium text-slate-400">
                        {formatCurrency(Number(creditByAccount[a._id]) || 0)}
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
        {!sortedAccounts.length && !loading ? (
          <div className="px-6 py-8 text-sm text-slate-500">No accounts found.</div>
        ) : null}
      </div>
    </Container>
  );
}
