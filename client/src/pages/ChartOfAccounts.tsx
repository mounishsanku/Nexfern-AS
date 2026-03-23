import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getStoredRole } from "@/components/RoleProtectedRoute";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

type Account = {
  _id: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isActive: boolean;
};

const TYPE_LABELS: Record<AccountType, string> = {
  asset:     "Asset",
  liability: "Liability",
  equity:    "Equity",
  revenue:   "Revenue",
  expense:   "Expense",
};

const TYPE_COLORS: Record<AccountType, string> = {
  asset:     "bg-blue-50 text-blue-700 ring-blue-200",
  liability: "bg-red-50 text-red-700 ring-red-200",
  equity:    "bg-purple-50 text-purple-700 ring-purple-200",
  revenue:   "bg-green-50 text-green-700 ring-green-200",
  expense:   "bg-orange-50 text-orange-700 ring-orange-200",
};

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

/** Parent must be the same account class as the child (matches server accountHierarchy rules). */
function accountsValidAsParentForType(accounts: Account[], childType: AccountType): Account[] {
  return accounts.filter((a) => a.type === childType);
}

function TypeBadge({ type }: { type: AccountType }) {
  return (
    <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", TYPE_COLORS[type])}>
      {TYPE_LABELS[type]}
    </span>
  );
}

// ─── Add Account Form ─────────────────────────────────────────────────────────

function AddAccountForm({
  token,
  accounts,
  onCreated,
}: {
  token: string;
  accounts: Account[];
  onCreated: (a: Account) => void;
}) {
  const [name, setName]       = React.useState("");
  const [type, setType]       = React.useState<AccountType>("asset");
  const [parentId, setParentId] = React.useState("");
  const [saving, setSaving]   = React.useState(false);
  const [error, setError]     = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<Account>("/accounts", {
        method: "POST",
        token,
        body: JSON.stringify({ name: name.trim(), type, parentId: parentId || null }),
      });
      onCreated(created);
      setName("");
      setType("asset");
      setParentId("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create account";
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code ?? "") : "";
      setError(code ? `${msg} (${code})` : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200"
    >
      <div className="mb-4 text-sm font-extrabold text-slate-900">Add Account</div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs font-semibold text-slate-600">Account Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bank Account"
            required
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as AccountType);
              setParentId("");
            }}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Parent Account (optional)</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— None —</option>
            {accountsValidAsParentForType(accounts, type).map((a) => (
              <option key={a._id} value={a._id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Add Account"}
        </Button>
      </div>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ChartOfAccounts() {
  const token = getStoredToken();
  const role  = getStoredRole();
  const canManage = role === "admin";
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    apiFetch<Account[]>("/accounts", { token })
      .then((data) => { setAccounts(data); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load accounts"); setLoading(false); });
  }, [token]);

  if (!token) {
    return (
      <Container className="py-10">
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          Missing auth token. Please login again.
        </div>
      </Container>
    );
  }

  // Group accounts by type for display
  const grouped = (Object.keys(TYPE_LABELS) as AccountType[]).reduce<Record<AccountType, Account[]>>(
    (acc, t) => { acc[t] = accounts.filter((a) => a.type === t); return acc; },
    { asset: [], liability: [], equity: [], revenue: [], expense: [] }
  );

  return (
    <Container className="py-10">
      <div className="mb-6">
        <div className="text-sm font-semibold text-slate-500">Accounting</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
          Chart of Accounts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your accounting structure. All voucher entries are linked to these accounts.
        </p>
      </div>

      {canManage && (
        <div className="mb-8">
          <AddAccountForm
            token={token}
            accounts={accounts}
            onCreated={(a) => setAccounts((prev) => [...prev, a])}
          />
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm font-semibold text-slate-500">Loading…</div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {(Object.keys(TYPE_LABELS) as AccountType[]).map((type) => {
            const rows = grouped[type];
            if (rows.length === 0) return null;
            return (
              <div
                key={type}
                className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200"
              >
                <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-6 py-3">
                  <TypeBadge type={type} />
                  <span className="text-sm font-extrabold text-slate-900">
                    {TYPE_LABELS[type]} Accounts
                  </span>
                  <span className="ml-auto text-xs font-semibold text-slate-400">
                    {rows.length} account{rows.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <table className="min-w-full border-collapse">
                  <thead className="bg-slate-50/50">
                    <tr>
                      {["Account Name", "Type", "Parent"].map((h) => (
                        <th key={h} className="px-6 py-2.5 text-left text-xs font-semibold text-slate-600">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((acct) => {
                      const parent = accounts.find((a) => a._id === acct.parentId);
                      return (
                        <tr key={acct._id} className="bg-white hover:bg-slate-50">
                          <td className="px-6 py-3 text-sm font-semibold text-slate-900">
                            {parent && (
                              <span className="mr-1 text-slate-400">↳</span>
                            )}
                            {acct.name}
                          </td>
                          <td className="px-6 py-3">
                            <TypeBadge type={acct.type} />
                          </td>
                          <td className="px-6 py-3 text-sm text-slate-500">
                            {parent?.name ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </Container>
  );
}
