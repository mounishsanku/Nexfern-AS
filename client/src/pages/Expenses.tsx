import * as React from "react";
import { apiFetch, apiUpload, API, getStoredToken } from "@/api";

const BASE = API.replace("/api", "");
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { VirtualizedTable, type VirtualTableColumn } from "@/components/VirtualizedTable";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/context/ToastContext";
import { useFirstFieldFocus, createFormEnterSubmitHandler } from "@/hooks/useFormEnhancements";

const CATEGORIES = ["rent", "salary", "marketing", "tools", "utilities", "travel", "other"];

type Vendor = { _id: string; name: string; email?: string; phone?: string };

type ExpenseStatus = "pending" | "approved" | "rejected";

type Expense = {
  _id: string;
  title: string;
  amount: number;
  category: string;
  vendorId?: Vendor | null;
  attachmentUrl?: string | null;
  billUrl?: string | null;
  isRecurring?: boolean;
  recurringInterval?: string | null;
  date: string;
  createdAt: string;
  status?: ExpenseStatus | string;
};

const INPUT = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

function statusVariant(s: string | undefined): "success" | "danger" | "warning" {
  const x = String(s || "pending").toLowerCase();
  if (x === "approved") return "success";
  if (x === "rejected") return "danger";
  return "warning";
}

/** Approximate next monthly run from expense date (UI hint only). */
function nextRecurringHint(expenseDate: string): string {
  const base = new Date(expenseDate);
  if (Number.isNaN(base.getTime())) return "—";
  const next = new Date(base.getFullYear(), base.getMonth() + 1, Math.min(base.getDate(), 28));
  return next.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function ExpensesInner() {
  const { success, error: toastError } = useToast();
  const formEnterSubmit = React.useMemo(() => createFormEnterSubmitHandler(), []);
  const token = getStoredToken();
  const role  = typeof window !== "undefined" ? window.localStorage.getItem("role") : null;
  const canManage = role === "admin" || role === "accountant";
  const canSubmitExpense = canManage || role === "receptionist";

  // ── list state ──────────────────────────────────────────────────────────────
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [vendors,  setVendors]  = React.useState<Vendor[]>([]);
  const [loading,  setLoading]  = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);

  // ── filter state ────────────────────────────────────────────────────────────
  const [fVendor,   setFVendor]   = React.useState("");
  const [fCategory, setFCategory] = React.useState("");
  const [fStatus,   setFStatus]   = React.useState<"" | "pending" | "approved" | "rejected">("");
  const [fStart,    setFStart]    = React.useState("");
  const [fEnd,      setFEnd]      = React.useState("");

  // ── form state ──────────────────────────────────────────────────────────────
  const [showForm,       setShowForm]       = React.useState(false);
  const titleFieldRef = useFirstFieldFocus<HTMLInputElement>(showForm);
  const [title,          setTitle]          = React.useState("");
  const [amount,         setAmount]         = React.useState("");
  const [category,       setCategory]       = React.useState(CATEGORIES[0]);
  const [vendorId,       setVendorId]       = React.useState("");
  const [date,           setDate]           = React.useState(() => new Date().toISOString().slice(0, 10));
  const [attachmentUrl,  setAttachmentUrl]  = React.useState<string | null>(null);
  const [isRecurring,    setIsRecurring]    = React.useState(false);
  const [tdsApplicable,  setTdsApplicable]  = React.useState(false);
  const [tdsRate,        setTdsRate]        = React.useState("1");
  const [uploading,      setUploading]      = React.useState(false);
  const [creating,       setCreating]       = React.useState(false);
  const [formError,      setFormError]      = React.useState<string | null>(null);

  const [runRecurringLoading, setRunRecurringLoading] = React.useState(false);
  const [runRecurringMsg,     setRunRecurringMsg]     = React.useState<string | null>(null);
  const [runRecurringTone,    setRunRecurringTone]    = React.useState<"success" | "info" | "error">("success");
  const [actionBusyId, setActionBusyId] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<
    null | { type: "approve" | "reject"; id: string; title: string }
  >(null);

  // ── vendor form ─────────────────────────────────────────────────────────────
  const [showVendorForm, setShowVendorForm] = React.useState(false);
  const [vName,  setVName]  = React.useState("");
  const [vEmail, setVEmail] = React.useState("");
  const [vPhone, setVPhone] = React.useState("");
  const [vGst,   setVGst]   = React.useState("");
  const [savingVendor, setSavingVendor] = React.useState(false);

  // ── fetch ────────────────────────────────────────────────────────────────────
  async function fetchVendors() {
    if (!token) return;
    try {
      const data = await apiFetch<Vendor[]>("/vendors", { token });
      setVendors(Array.isArray(data) ? data : []);
    } catch { /* non-fatal */ }
  }

  async function fetchExpenses() {
    if (!token) { setError("Missing auth token."); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (fVendor)   params.set("vendorId",  fVendor);
      if (fCategory) params.set("category",  fCategory);
      if (fStart)    params.set("startDate", fStart);
      if (fEnd)      params.set("endDate",   fEnd);
      const qs = params.toString();
      const data = await apiFetch<Expense[]>(`/expenses${qs ? `?${qs}` : ""}`, { token });
      setExpenses(Array.isArray(data) ? data : []);
    } catch (e) {
      const err = e as Error & { code?: string };
      const msg = err.message || "Failed to load expenses.";
      const unreachable =
        err.code === "API_SERVER_UNREACHABLE" || msg.includes("API_SERVER_UNREACHABLE");
      setError(
        unreachable
          ? `Cannot reach the API server. Start the backend (port 5000), or use VITE_USE_PROXY=1 (Vite proxy). Current API base: ${API || "(empty)"}`
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void fetchVendors();
    void fetchExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── file upload ──────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const json = await apiUpload<{ url: string }>("/expenses/upload", fd, { token });
      setAttachmentUrl(json.url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const parsedAmount = Number(amount);
  const parsedTdsRate = Number(tdsRate);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const titleOk = title.trim().length > 0;
  const amountOk = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const categoryOk = Boolean(category?.trim());
  const tdsOk =
    !tdsApplicable ||
    (Number.isFinite(parsedTdsRate) && parsedTdsRate >= 0 && parsedTdsRate <= 30);
  const isFormValid = titleOk && amountOk && dateOk && categoryOk && tdsOk;

  // ── create expense ───────────────────────────────────────────────────────────
  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!isFormValid) {
      setFormError("Please fix validation errors before submitting.");
      return;
    }

    setCreating(true); setFormError(null);
    try {
      await apiFetch("/expenses", {
        method: "POST", token,
        body: JSON.stringify({
          title: title.trim(), amount: parsedAmount, category,
          vendorId: vendorId || undefined,
          attachmentUrl: attachmentUrl || undefined,
          billUrl: attachmentUrl || undefined,
          isRecurring: isRecurring,
          recurringInterval: isRecurring ? "monthly" : undefined,
          tdsApplicable: tdsApplicable,
          tdsRate: tdsApplicable ? parsedTdsRate : undefined,
          date,
        }),
      });
      setShowForm(false);
      setTitle(""); setAmount(""); setCategory(CATEGORIES[0]);
      setVendorId(""); setAttachmentUrl(null); setIsRecurring(false);
      setTdsApplicable(false); setTdsRate("1");
      setDate(new Date().toISOString().slice(0, 10));
      success("Expense submitted.");
      await fetchExpenses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create expense.";
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code ?? "") : "";
      setFormError(code ? `${msg} (${code})` : msg);
    } finally {
      setCreating(false);
    }
  }

  // ── create vendor ────────────────────────────────────────────────────────────
  async function onCreateVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !vName.trim()) return;
    setSavingVendor(true);
    try {
      const v = await apiFetch<Vendor>("/vendors", {
        method: "POST", token,
        body: JSON.stringify({ name: vName.trim(), email: vEmail || undefined, phone: vPhone || undefined, gstNumber: vGst || undefined }),
      });
      setVendors((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)));
      setVendorId(v._id);
      setShowVendorForm(false);
      setVName(""); setVEmail(""); setVPhone(""); setVGst("");
    } catch { /* ignore */ } finally {
      setSavingVendor(false);
    }
  }

  async function approveExpense(id: string) {
    if (!token) return;
    setActionBusyId(id);
    setError(null);
    try {
      await apiFetch(`/expenses/${id}/approve`, { method: "POST", token, body: JSON.stringify({}) });
      success("Expense approved.");
      await fetchExpenses();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Approve failed";
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code ?? "") : "";
      const full = code ? `${msg} (${code})` : msg;
      setError(full);
      toastError(full);
    } finally {
      setActionBusyId(null);
    }
  }

  async function rejectExpense(id: string) {
    if (!token) return;
    setActionBusyId(id);
    setError(null);
    try {
      await apiFetch(`/expenses/${id}/reject`, { method: "POST", token, body: JSON.stringify({}) });
      success("Expense rejected.");
      await fetchExpenses();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Reject failed";
      const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code ?? "") : "";
      const full = code ? `${msg} (${code})` : msg;
      setError(full);
      toastError(full);
    } finally {
      setActionBusyId(null);
    }
  }

  const visibleExpenses = React.useMemo(() => {
    if (!fStatus) return expenses;
    return expenses.filter((e) => String(e.status || "pending").toLowerCase() === fStatus);
  }, [expenses, fStatus]);

  async function handleRunRecurring() {
    if (!token) return;
    setRunRecurringLoading(true); setRunRecurringMsg(null);
    try {
      const res = await apiFetch<{
        message?: string;
        count?: number;
        code?: string;
        skipped?: Array<{ templateId?: string; reason?: string }>;
        expenses?: Expense[];
      }>("/expenses/run-recurring", {
        method: "POST", token,
      });
      const created = res.count ?? 0;
      if (created === 0) {
        setRunRecurringTone("info");
        const skipDetail =
          res.skipped && res.skipped.length > 0
            ? ` — ${res.skipped.map((s) => s.reason).filter(Boolean).join("; ")}`
            : "";
        setRunRecurringMsg(
          (res.message ?? "No recurring expenses created") + skipDetail,
        );
      } else {
        setRunRecurringTone("success");
        setRunRecurringMsg(res.message ?? `Created ${created} expense(s)`);
      }
      await fetchExpenses();
    } catch (e) {
      setRunRecurringTone("error");
      setRunRecurringMsg(e instanceof Error ? e.message : "Failed to run recurring");
    } finally {
      setRunRecurringLoading(false);
    }
  }

  const isImage = (url: string) => /\.(jpg|jpeg|png|webp)$/i.test(url);
  const billOrAttachment = (exp: Expense) => exp.billUrl || exp.attachmentUrl;

  const expenseColumns = React.useMemo((): VirtualTableColumn<Expense>[] => {
    return [
      {
        id: "title",
        header: "Title",
        width: "minmax(140px,1.2fr)",
        cell: (exp) => <span className="font-semibold text-slate-900">{exp.title}</span>,
      },
      {
        id: "amount",
        header: "Amount",
        align: "right",
        width: "96px",
        cell: (exp) => formatCurrency(exp.amount, { maximumFractionDigits: 0 }),
      },
      {
        id: "category",
        header: "Category",
        width: "120px",
        cell: (exp) => (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
            {exp.category}
          </span>
        ),
      },
      {
        id: "vendor",
        header: "Vendor",
        width: "minmax(80px,1fr)",
        hideBelowMd: true,
        cell: (exp) => (
          <span className="text-slate-600">{exp.vendorId?.name ?? <span className="text-slate-300">—</span>}</span>
        ),
      },
      {
        id: "date",
        header: "Date",
        width: "110px",
        cell: (exp) => (
          <span className="text-slate-600">
            {exp.date ? new Date(exp.date).toLocaleDateString("en-IN") : "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        width: "100px",
        cell: (exp) => {
          const st = String(exp.status || "pending").toLowerCase();
          return <Badge variant={statusVariant(st)}>{st}</Badge>;
        },
      },
      {
        id: "bill",
        header: "Bill",
        width: "88px",
        hideBelowMd: true,
        cell: (exp) => {
          const url = billOrAttachment(exp);
          if (!url) return <span className="text-xs text-slate-300">—</span>;
          if (isImage(url)) {
            return (
              <a href={`${BASE}${url}`} target="_blank" rel="noreferrer">
                <img
                  src={`${BASE}${url}`}
                  alt="bill"
                  className="h-10 w-10 rounded-lg border border-slate-200 object-cover hover:opacity-80"
                />
              </a>
            );
          }
          return (
            <a
              href={`${BASE}${url}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              📄 PDF
            </a>
          );
        },
      },
      {
        id: "recurring",
        header: "Recurring",
        width: "minmax(100px,120px)",
        hideBelowLg: true,
        cell: (exp) =>
          exp.isRecurring ? (
            <div className="space-y-1">
              <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Monthly
              </span>
              <div className="text-[11px] font-medium text-slate-500">Next ~ {nextRecurringHint(exp.date)}</div>
            </div>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          ),
      },
      {
        id: "actions",
        header: "Actions",
        width: "168px",
        cell: (exp) => {
          const st = String(exp.status || "pending").toLowerCase();
          const showActions = canManage && st === "pending";
          if (!showActions) return <span className="text-xs text-slate-300">—</span>;
          return (
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={actionBusyId === exp._id}
                onClick={() => setConfirmAction({ type: "approve", id: exp._id, title: exp.title })}
              >
                {actionBusyId === exp._id ? "…" : "Approve"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={actionBusyId === exp._id}
                onClick={() => setConfirmAction({ type: "reject", id: exp._id, title: exp.title })}
              >
                Reject
              </Button>
            </div>
          );
        },
      },
    ];
  }, [canManage, actionBusyId]);

  return (
    <Container className="px-4 py-6 md:px-6 md:py-10">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">Expenses</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Track spending</h1>
        </div>
        <div className="flex items-center gap-3 self-end">
          {canManage ? (
            <Button variant="secondary" size="sm" onClick={() => void handleRunRecurring()} disabled={runRecurringLoading}>
              {runRecurringLoading ? "Running…" : "Run Recurring"}
            </Button>
          ) : null}
          {canSubmitExpense ? (
            <Button variant="primary" className="shadow-soft-lg" onClick={() => { setShowForm(true); setFormError(null); }}>
              Add Expense
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Global error / run recurring message ── */}
      {runRecurringMsg && (
        <div
          className={
            runRecurringTone === "success"
              ? "mt-4 rounded-2xl bg-green-50 p-4 text-sm font-semibold text-green-700 ring-1 ring-inset ring-green-200"
              : runRecurringTone === "info"
                ? "mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
                : "mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200"
          }
        >
          {runRecurringMsg}
        </div>
      )}
      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      {/* ── Filters ── */}
      <div className="mt-6 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Status</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className={INPUT}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Vendor</label>
            <select value={fVendor} onChange={(e) => setFVendor(e.target.value)} className={INPUT}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Category</label>
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={INPUT}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
            <input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
            <input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} className={INPUT} />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setFVendor(""); setFCategory(""); setFStatus(""); setFStart(""); setFEnd(""); }}>Clear</Button>
          <Button variant="primary" size="sm" onClick={() => void fetchExpenses()}>Apply</Button>
        </div>
      </div>

      {/* ── Add Expense Form ── */}
      {canSubmitExpense && showForm && (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
          <div className="mb-4 text-sm font-extrabold text-slate-900">New Expense</div>

          {formError && (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-inset ring-red-200">{formError}</div>
          )}
          {!isFormValid && (
            <div className="mb-4 rounded-xl bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
              <ul className="list-inside list-disc space-y-0.5">
                {!titleOk && <li>Title is required.</li>}
                {!amountOk && <li>Amount must be greater than 0.</li>}
                {!dateOk && <li>Date is required (YYYY-MM-DD).</li>}
                {!categoryOk && <li>Category is required.</li>}
                {!tdsOk && <li>TDS rate must be between 0 and 30.</li>}
              </ul>
            </div>
          )}

          <form onSubmit={onCreate} onKeyDown={formEnterSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Title */}
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600">
                Title <span className="text-red-500">*</span>
              </span>
              <input
                ref={titleFieldRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className={cx(INPUT, !titleOk && title.trim().length > 0 ? "ring-1 ring-red-200" : "")}
                placeholder="e.g. Office rent July"
              />
              {!titleOk && (title.trim().length > 0 || formError) ? (
                <p className="text-xs font-medium text-red-600">Title is required.</p>
              ) : null}
            </label>

            {/* Amount + Date */}
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">
                Amount (₹) <span className="text-red-500">*</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                min={0.01}
                step="0.01"
                className={cx(INPUT, !amountOk && amount.length > 0 ? "ring-1 ring-red-200" : "")}
              />
              {!amountOk && amount.length > 0 ? (
                <p className="text-xs font-medium text-red-600">Enter an amount greater than 0.</p>
              ) : null}
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">
                Date <span className="text-red-500">*</span>
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={cx(INPUT, !dateOk ? "ring-1 ring-red-200" : "")}
              />
              {!dateOk ? <p className="text-xs font-medium text-red-600">Use a valid date (YYYY-MM-DD).</p> : null}
            </label>

            {/* Category */}
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">
                Category <span className="text-red-500">*</span>
              </span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
              {!categoryOk ? <p className="text-xs font-medium text-red-600">Category is required.</p> : null}
            </label>

            {/* Vendor */}
            <div className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">Vendor</span>
              <div className="flex gap-2">
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={INPUT}>
                  <option value="">— No vendor —</option>
                  {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                </select>
                <button type="button" onClick={() => setShowVendorForm((v) => !v)}
                  className="shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  + New
                </button>
              </div>
            </div>

            {/* Inline vendor creation */}
            {showVendorForm && (
              <div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
                <div className="mb-3 text-xs font-extrabold text-slate-700">Add Vendor</div>
                <form onSubmit={onCreateVendor} className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Name *</span>
                    <input type="text" value={vName} onChange={(e) => setVName(e.target.value)} required className={INPUT} />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold text-slate-600">Email</span>
                    <input type="email" value={vEmail} onChange={(e) => setVEmail(e.target.value)} className={INPUT} />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold text-slate-600">Phone</span>
                    <input type="text" value={vPhone} onChange={(e) => setVPhone(e.target.value)} className={INPUT} />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">GST Number</span>
                    <input type="text" value={vGst} onChange={(e) => setVGst(e.target.value)} className={INPUT} />
                  </label>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" type="button" onClick={() => setShowVendorForm(false)}>Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" disabled={savingVendor}>{savingVendor ? "Saving…" : "Save Vendor"}</Button>
                  </div>
                </form>
              </div>
            )}

            {/* Recurring toggle */}
            {canManage ? (
              <div className="flex items-center gap-3 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                  <span className="text-xs font-semibold text-slate-600">Recurring (monthly)</span>
                </label>
              </div>
            ) : null}

            <div className="flex items-center gap-3 sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={tdsApplicable} onChange={(e) => setTdsApplicable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                <span className="text-xs font-semibold text-slate-600">TDS Applicable</span>
              </label>
              {tdsApplicable ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-600">Rate %</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={30}
                    step="0.01"
                    value={tdsRate}
                    onChange={(e) => setTdsRate(e.target.value)}
                    className={cx(
                      "h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      !tdsOk ? "ring-1 ring-red-200" : "",
                    )}
                  />
                  {!tdsOk ? <p className="text-xs font-medium text-red-600">TDS rate must be between 0 and 30.</p> : null}
                </label>
              ) : null}
            </div>

            {/* File upload (Bill) */}
            <div className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600">Bill (PDF / image)</span>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  {uploading ? "Uploading…" : attachmentUrl ? "Replace file" : "Choose file"}
                  <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={handleFileChange} disabled={uploading} />
                </label>
                {attachmentUrl && (
                  <button type="button" onClick={() => setAttachmentUrl(null)} className="text-xs font-semibold text-red-500 hover:underline">Remove</button>
                )}
              </div>

              {/* Preview */}
              {attachmentUrl && (
                <div className="mt-2">
                  {isImage(attachmentUrl) ? (
                    <img src={`${BASE}${attachmentUrl}`} alt="bill preview"
                      className="h-32 w-auto rounded-xl border border-slate-200 object-cover shadow-sm" />
                  ) : (
                    <a href={`${BASE}${attachmentUrl}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      📄 View PDF
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="sm:col-span-2 flex justify-end gap-3">
              <Button variant="ghost" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={creating || uploading || !isFormValid} className="shadow-soft-lg">
                {creating ? "Saving…" : "Add Expense"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Expense Table ── */}
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="flex items-center justify-between px-4 py-4 md:px-6">
          <div className="text-sm font-semibold text-slate-600">Expense list</div>
          {expenses.length > 0 && (
            <div className="text-xs font-semibold text-slate-400">{expenses.length} record{expenses.length !== 1 ? "s" : ""}</div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2 px-4 pb-6 md:px-6">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="px-4 pb-8 md:px-6">
            <EmptyState title="No expenses found" description="Add an expense or adjust filters." />
          </div>
        ) : visibleExpenses.length === 0 ? (
          <div className="px-4 pb-8 md:px-6">
            <EmptyState title="No expenses match status filter" description="Clear the status filter to see all loaded rows." />
          </div>
        ) : (
          <VirtualizedTable
            rows={visibleExpenses}
            columns={expenseColumns}
            rowKey={(r) => r._id}
            rowHeight={92}
            minTableWidth={1100}
            maxHeight={560}
          />
        )}
      </div>

      <ConfirmModal
        open={confirmAction !== null}
        title={confirmAction?.type === "approve" ? "Approve expense?" : "Reject expense?"}
        message={
          confirmAction ? (
            <>
              <span className="font-semibold text-slate-800">{confirmAction.title}</span>
              {confirmAction.type === "reject" ? (
                <span className="mt-2 block text-slate-600">
                  No payment or voucher will be posted for a rejected expense.
                </span>
              ) : (
                <span className="mt-2 block text-slate-600">
                  Approved expenses move forward in your payment workflow.
                </span>
              )}
            </>
          ) : null
        }
        confirmLabel={confirmAction?.type === "approve" ? "Approve" : "Reject"}
        danger={confirmAction?.type === "reject"}
        loading={false}
        onCancel={() => {
          if (!actionBusyId) setConfirmAction(null);
        }}
        onConfirm={() => {
          if (!confirmAction) return;
          const { type, id } = confirmAction;
          setConfirmAction(null);
          if (type === "approve") void approveExpense(id);
          else void rejectExpense(id);
        }}
      />
    </Container>
  );
}

export const Expenses = React.memo(ExpensesInner);
