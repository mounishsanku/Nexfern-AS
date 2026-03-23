import * as React from "react";
import { apiFetch, apiFetchBlob, getStoredToken } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineSpinner } from "@/components/ui/Spinner";
import { inputClassName } from "@/components/ui/Input";
import { FieldError } from "@/components/ui/Input";
import { VirtualizedTable, type VirtualTableColumn } from "@/components/VirtualizedTable";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/context/ToastContext";
import { useFirstFieldFocus, createFormEnterSubmitHandler } from "@/hooks/useFormEnhancements";

type Invoice = {
  _id: string;
  invoiceNumber?: string | null;
  customer?: { _id: string; name: string } | null;
  amount: number;
  gst: number;
  totalAmount: number;
  revenueType?: "project" | "academy" | "event";
  paidAmount?: number;
  status: "paid" | "unpaid" | "partial" | string;
  createdAt: string;
};

type Customer = {
  _id: string;
  name: string;
};

function invoiceDisplayNumber(inv: Invoice): string {
  const raw = typeof inv.invoiceNumber === "string" ? inv.invoiceNumber.trim() : "";
  if (raw) return raw;
  if (import.meta.env.DEV) {
    console.warn("[FinanceOS] Invoice missing invoiceNumber in UI — run migrateInvoiceNumbers or re-save", inv._id);
  }
  return `INV-${String(inv._id).slice(-8).toUpperCase()}`;
}

function effectiveStatus(inv: Invoice): "paid" | "partial" | "unpaid" {
  const paidAmount = inv.paidAmount ?? 0;
  const remaining = Math.max(0, inv.totalAmount - paidAmount);
  if (remaining <= 0) return "paid";
  const statusLower = String(inv.status).toLowerCase();
  if (statusLower === "partial") return "partial";
  return "unpaid";
}

function InvoicesInner() {
  const { success, error: toastError } = useToast();
  const createFormEnter = React.useMemo(() => createFormEnterSubmitHandler(), []);
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [showCreate, setShowCreate] = React.useState(false);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [customerId, setCustomerId] = React.useState("");
  const [amount, setAmount] = React.useState<string>("");
  const [gst, setGst] = React.useState<string>("");
  const [revenueType, setRevenueType] = React.useState<"project" | "academy" | "event">("project");
  const [isDeferred, setIsDeferred] = React.useState(false);
  const [deferredMonths, setDeferredMonths] = React.useState<string>("3");
  const [creating, setCreating] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [filterStatus, setFilterStatus] = React.useState<"" | "paid" | "partial" | "unpaid">("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  const [paymentInvoiceId, setPaymentInvoiceId] = React.useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = React.useState<string>("");
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank" | "upi">("cash");
  const [paymentSubmitting, setPaymentSubmitting] = React.useState(false);
  const [paymentError, setPaymentError] = React.useState<string | null>(null);

  const [pdfDownloadingId, setPdfDownloadingId] = React.useState<string | null>(null);

  const customerFieldRef = useFirstFieldFocus<HTMLSelectElement>(showCreate);
  const paymentAmountRef = useFirstFieldFocus<HTMLInputElement>(Boolean(paymentInvoiceId));

  const token = getStoredToken();
  const role =
    typeof window !== "undefined" ? window.localStorage.getItem("role") : null;

  const canCreateInvoice = role === "admin" || role === "accountant" || role === "receptionist";
  const canAddPayment = role === "admin" || role === "accountant";

  const filteredInvoices = React.useMemo(() => {
    if (!invoices) return null;
    let list = [...invoices];
    if (filterStatus) {
      list = list.filter((inv) => effectiveStatus(inv) === filterStatus);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter((inv) => {
        const d = new Date(inv.createdAt);
        return !Number.isNaN(d.getTime()) && d >= from;
      });
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((inv) => {
        const d = new Date(inv.createdAt);
        return !Number.isNaN(d.getTime()) && d <= to;
      });
    }
    return list;
  }, [invoices, filterStatus, dateFrom, dateTo]);

  const onDownloadPdf = (id: string, invoiceNumber?: string | null) => {
    if (!token) {
      setError("Missing auth token. Please login again.");
      return;
    }
    setPdfDownloadingId(id);
    apiFetchBlob(`/invoices/${id}/pdf`, { token })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safe =
          invoiceNumber && String(invoiceNumber).trim()
            ? String(invoiceNumber).replace(/[^\w.-]+/g, "_")
            : `invoice-${id}`;
        a.download = `${safe}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        success("Invoice PDF downloaded.");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to download invoice.";
        toastError(msg);
        setError(msg);
      })
      .finally(() => setPdfDownloadingId(null));
  };

  async function fetchCustomers() {
    if (!token) return;

    try {
      const json = await apiFetch<Customer[] | { message?: string }>(
        "/customers",
        { token },
      );

      setCustomers(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error("Failed to load customers:", err);
    }
  }

  async function fetchInvoices() {
    if (!token) {
      setError("Missing auth token. Please login again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setInvoices(null);

    try {
      const data = await apiFetch<Invoice[] | { message?: string }>(
        "/invoices",
        { token },
      );

      const list = Array.isArray(data) ? data : [];
      for (const inv of list) {
        if (!inv.invoiceNumber?.trim?.()) {
          console.warn("[FinanceOS] Loaded invoice without invoiceNumber", inv._id);
        }
      }
      setInvoices(list);
      setLoading(false);
      return;
    } catch (err) {
      console.error("Failed to load invoices:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load invoices.",
      );
      setLoading(false);
    }
  }

  async function addPayment(
    invoiceId: string,
    amt: number,
    method: "cash" | "bank" | "upi",
  ) {
    const inv = invoices?.find((invoice) => invoice._id === invoiceId);
    const paid = inv?.paidAmount ?? 0;
    const remaining = Math.max(0, (inv?.totalAmount ?? 0) - paid);

    if (amt <= 0 || !Number.isFinite(amt)) {
      setPaymentError("Payment amount must be a valid number > 0.");
      return;
    }
    if (amt > remaining) {
      setPaymentError(`Payment exceeds remaining amount (${formatCurrency(remaining)}).`);
      return;
    }

    setPaymentSubmitting(true);
    setPaymentError(null);

    try {
      await apiFetch<{ message?: string }>("/payments", {
        method: "POST",
        token,
        body: JSON.stringify({ invoiceId, amount: amt, method }),
      });

      setPaymentInvoiceId(null);
      setPaymentAmount("");
      success("Payment recorded.");
      await fetchInvoices();
    } catch (err) {
      console.error("Failed to add invoice payment:", err);
      setPaymentError(
        err instanceof Error ? err.message : "Failed to add payment.",
      );
    } finally {
      setPaymentSubmitting(false);
    }
  }

  function openPayment(invoiceId: string) {
    const inv = invoices?.find((invoice) => invoice._id === invoiceId);
    const paid = inv?.paidAmount ?? 0;
    const remaining = Math.max(0, (inv?.totalAmount ?? 0) - paid);

    setPaymentInvoiceId(invoiceId);
    setPaymentAmount(String(remaining > 0 ? remaining : ""));
    setPaymentMethod("cash");
    setPaymentError(null);
  }

  function markAsPaid(invoiceId: string) {
    const inv = invoices?.find((invoice) => invoice._id === invoiceId);
    const paid = inv?.paidAmount ?? 0;
    const remaining = Math.max(0, (inv?.totalAmount ?? 0) - paid);
    if (!remaining) return;
    void addPayment(invoiceId, remaining, "cash");
  }

  const selectedInvoice =
    paymentInvoiceId && invoices
      ? invoices.find((invoice) => invoice._id === paymentInvoiceId) ?? null
      : null;

  const selectedRemaining = selectedInvoice
    ? Math.max(0, selectedInvoice.totalAmount - (selectedInvoice.paidAmount ?? 0))
    : 0;

  const invoiceColumns = React.useMemo((): VirtualTableColumn<Invoice>[] => {
    return [
      {
        id: "num",
        header: "Invoice #",
        width: "112px",
        cell: (inv) => (
          <span className="font-mono text-xs font-semibold sm:text-sm">{invoiceDisplayNumber(inv)}</span>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        width: "minmax(120px,1fr)",
        hideBelowMd: true,
        cell: (inv) => <span className="font-semibold text-slate-900">{inv.customer?.name ?? "—"}</span>,
      },
      {
        id: "total",
        header: "Total",
        align: "right",
        width: "100px",
        cell: (inv) => formatCurrency(inv.totalAmount),
      },
      {
        id: "paid",
        header: "Paid",
        align: "right",
        width: "100px",
        hideBelowMd: true,
        cell: (inv) => formatCurrency(inv.paidAmount ?? 0),
      },
      {
        id: "rem",
        header: "Due",
        align: "right",
        width: "100px",
        cell: (inv) => (
          <span className="font-extrabold">{formatCurrency(Math.max(0, inv.totalAmount - (inv.paidAmount ?? 0)))}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        width: "minmax(140px,200px)",
        cell: (inv) => {
          const paidAmount = inv.paidAmount ?? 0;
          const remaining = Math.max(0, inv.totalAmount - paidAmount);
          const eff = effectiveStatus(inv);
          const badgeText = eff === "paid" ? "PAID" : eff === "partial" ? "PARTIAL" : "UNPAID";
          const variant = eff === "paid" ? "success" : eff === "partial" ? "warning" : "danger";
          return (
            <div className="flex flex-col gap-1">
              <Badge variant={variant}>{badgeText}</Badge>
              {canAddPayment && remaining > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => markAsPaid(inv._id)}
                    disabled={remaining <= 0}
                  >
                    Paid
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    onClick={() => openPayment(inv._id)}
                    disabled={remaining <= 0}
                  >
                    Pay
                  </Button>
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "date",
        header: "Date",
        width: "104px",
        hideBelowLg: true,
        cell: (inv) => (inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("en-IN") : "—"),
      },
      {
        id: "pdf",
        header: "PDF",
        width: "104px",
        cell: (inv) => (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={pdfDownloadingId === inv._id}
            onClick={() => onDownloadPdf(inv._id, inv.invoiceNumber)}
            className="inline-flex items-center gap-1.5"
            aria-busy={pdfDownloadingId === inv._id}
          >
            {pdfDownloadingId === inv._id ? (
              <>
                <InlineSpinner />
                <span className="sr-only">Downloading</span>
              </>
            ) : (
              "PDF"
            )}
          </Button>
        ),
      },
    ];
  }, [canAddPayment, pdfDownloadingId]);

  React.useEffect(() => {
    void fetchInvoices();
    void fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearFieldErrors() {
    setFieldErrors({});
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const nextErrors: Record<string, string> = {};
    const parsedAmount = Number(amount);
    const parsedGst = Number(gst);

    if (!customerId) nextErrors.customerId = "Select a customer.";
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      nextErrors.amount = "Amount must be a non-negative number.";
    }
    if (!Number.isFinite(parsedGst) || parsedGst < 0) {
      nextErrors.gst = "GST must be a non-negative number.";
    }

    const deferred = Boolean(isDeferred);
    const months = deferred
      ? Math.max(1, Math.min(120, Math.floor(Number(deferredMonths) || 1)))
      : undefined;

    if (deferred && (!months || months < 1)) {
      nextErrors.deferredMonths = "Deferred months must be between 1 and 120.";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Please fix the highlighted fields.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      await apiFetch<Invoice | { message?: string }>("/invoices", {
        method: "POST",
        token,
        body: JSON.stringify({
          customerId,
          amount: parsedAmount,
          gstRate: parsedGst,
          revenueType,
          ...(deferred && { isDeferred: true, deferredMonths: months }),
        }),
      });

      setShowCreate(false);
      setCustomerId("");
      setAmount("");
      setGst("");
      setRevenueType("project");
      setIsDeferred(false);
      setDeferredMonths("3");
      clearFieldErrors();
      success("Invoice created.");
      await fetchInvoices();
      setCreating(false);
      return;
    } catch (err) {
      console.error("Failed to create invoice:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create invoice.",
      );
      setCreating(false);
    }
  }

  return (
    <Container className="px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-600">Invoices</div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
            Billing records
          </h1>
        </div>

        <div className="flex items-center gap-3 self-end">
          {canCreateInvoice ? (
            <Button
              variant="primary"
              className="shadow-soft-lg"
              onClick={() => {
                setShowCreate(true);
                clearFieldErrors();
              }}
            >
              Create Invoice
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      {canCreateInvoice && showCreate ? (
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
          <div className="text-sm font-semibold text-slate-600">Create invoice</div>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={onCreate}
            onKeyDown={createFormEnter}
          >
            <div className="grid gap-1 sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">
                Customer <span className="text-red-500">*</span>
              </span>
              <select
                ref={customerFieldRef}
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setFieldErrors((s) => ({ ...s, customerId: "" }));
                }}
                required
                className={inputClassName}
                aria-invalid={Boolean(fieldErrors.customerId)}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer._id} value={customer._id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <FieldError>{fieldErrors.customerId}</FieldError>
            </div>

            <div className="rounded-xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-100 sm:col-span-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Amounts</div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1">
                  <span className="text-sm font-semibold text-slate-700">
                    Amount (₹) <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setFieldErrors((s) => ({ ...s, amount: "" }));
                    }}
                    required
                    min={0}
                    step="0.01"
                    className={inputClassName}
                    aria-invalid={Boolean(fieldErrors.amount)}
                  />
                  <FieldError>{fieldErrors.amount}</FieldError>
                </div>

                <div className="grid gap-1">
                  <span className="text-sm font-semibold text-slate-700">
                    GST % <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={gst}
                    onChange={(e) => {
                      setGst(e.target.value);
                      setFieldErrors((s) => ({ ...s, gst: "" }));
                    }}
                    required
                    min={0}
                    step="0.01"
                    className={inputClassName}
                    aria-invalid={Boolean(fieldErrors.gst)}
                  />
                  <FieldError>{fieldErrors.gst}</FieldError>
                </div>
              </div>
            </div>

            <div className="grid gap-1">
              <span className="text-sm font-semibold text-slate-700">Revenue type</span>
              <select
                value={revenueType}
                onChange={(e) => setRevenueType(e.target.value as "project" | "academy" | "event")}
                className={inputClassName}
              >
                <option value="project">Project</option>
                <option value="academy">Academy</option>
                <option value="event">Event</option>
              </select>
            </div>

            <div className="flex flex-col justify-end gap-0 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isDeferred}
                    onChange={(e) => setIsDeferred(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                  />
                  <span className="text-sm font-semibold text-slate-700">Deferred revenue</span>
                </label>
                {isDeferred ? (
                  <label className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">Months</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={deferredMonths}
                      onChange={(e) => {
                        setDeferredMonths(e.target.value);
                        setFieldErrors((s) => ({ ...s, deferredMonths: "" }));
                      }}
                      min={1}
                      max={120}
                      className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      aria-invalid={Boolean(fieldErrors.deferredMonths)}
                    />
                  </label>
                ) : null}
              </div>
              <FieldError>{fieldErrors.deferredMonths}</FieldError>
            </div>

            <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                type="button"
                className="justify-center"
                onClick={() => {
                  setShowCreate(false);
                  clearFieldErrors();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creating}
                className="justify-center shadow-soft-lg"
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Filters</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">Status</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className={inputClassName}
            >
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">From date</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClassName} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">To date</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClassName} />
          </label>
          <div className="flex items-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setFilterStatus("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="px-6 py-4">
          <div className="text-sm font-semibold text-slate-600">Invoice list</div>
        </div>

        {loading ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : invoices && invoices.length === 0 ? (
          <div className="px-6 pb-8">
            <EmptyState title="No invoices found" description="Create your first invoice to see it here." />
          </div>
        ) : invoices && filteredInvoices && filteredInvoices.length === 0 ? (
          <div className="px-6 pb-8">
            <EmptyState title="No invoices match filters" description="Adjust filters or clear them to see all invoices." />
          </div>
        ) : invoices && filteredInvoices ? (
          <VirtualizedTable
            rows={filteredInvoices}
            columns={invoiceColumns}
            rowKey={(r) => r._id}
            rowHeight={112}
            maxHeight={560}
            minTableWidth={1100}
            threshold={200}
          />
        ) : null}
      </div>

      <Modal
        open={Boolean(paymentInvoiceId && selectedInvoice)}
        title="Add payment"
        onClose={() => !paymentSubmitting && setPaymentInvoiceId(null)}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setPaymentInvoiceId(null)}
              disabled={paymentSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="payment-form"
              disabled={paymentSubmitting || selectedRemaining <= 0}
            >
              {paymentSubmitting ? "Adding…" : "Add payment"}
            </Button>
          </>
        }
      >
        {selectedInvoice ? (
          <>
            <div className="text-base font-extrabold text-slate-900">
              {selectedInvoice.customer?.name ?? "—"}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Remaining: {formatCurrency(selectedRemaining)}
            </div>

            {paymentError ? (
              <div className="mt-3">
                <ErrorMessage>{paymentError}</ErrorMessage>
              </div>
            ) : null}

            <form
              id="payment-form"
              className="mt-4 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!paymentInvoiceId) return;
                void addPayment(paymentInvoiceId, Number(paymentAmount), paymentMethod);
              }}
              onKeyDown={createFormEnter}
            >
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-slate-700">
                  Amount <span className="text-red-500">*</span>
                </span>
                <input
                  ref={paymentAmountRef}
                  type="number"
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                  min={0}
                  step="0.01"
                  className={inputClassName}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-slate-700">Method</span>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value as "cash" | "bank" | "upi",
                    )
                  }
                  required
                  className={inputClassName}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="upi">UPI</option>
                </select>
              </label>
            </form>
          </>
        ) : null}
      </Modal>
    </Container>
  );
}

export const Invoices = React.memo(InvoicesInner);
