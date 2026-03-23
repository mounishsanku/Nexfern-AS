import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/Modal";
import { TableWrap, Table, THead, Th, TBody, Td } from "@/components/ui/Table";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/lib/format";
import { nexfernCsvFilename } from "@/lib/exportFilename";
import { useToast } from "@/context/ToastContext";

type TdsRecord = {
  expenseId: string;
  vendorId?: string | null;
  vendorName: string;
  vendorEmail?: string | null;
  vendorGstNumber?: string | null;
  amount: number;
  tdsAmount: number;
  date: string;
};

type TdsVendorSummary = {
  vendorId?: string | null;
  vendorName: string;
  vendorEmail?: string | null;
  vendorGstNumber?: string | null;
  totalBaseAmount: number;
  totalTds: number;
  deductionsCount: number;
};

type TdsReport = {
  totalTds: number;
  records: TdsRecord[];
  vendorSummary: TdsVendorSummary[];
  export?: {
    headers: string[];
    rows: Array<Record<string, unknown>>;
  };
};

function fmt(n: number) {
  return formatCurrency(n || 0);
}

export function Tds() {
  const { success, error: toastError } = useToast();
  const token = getStoredToken();
  const [report, setReport] = React.useState<TdsReport>({
    totalTds: 0,
    records: [],
    vendorSummary: [],
    export: { headers: [], rows: [] },
  });
  const [payAmount, setPayAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [payConfirmOpen, setPayConfirmOpen] = React.useState(false);

  async function fetchReport() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TdsReport>("/tds/report", { token });
      setReport(data);
      if (!payAmount) setPayAmount(String(data.totalTds || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load TDS report");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPay() {
    if (!token) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      const m = "Payment amount must be greater than 0.";
      setError(m);
      toastError(m);
      return;
    }
    setPaying(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ message?: string }>("/tds/pay", {
        method: "POST",
        token,
        body: JSON.stringify({ amount: amt }),
      });
      setMessage(res.message ?? "TDS payment recorded");
      success(res.message ?? "TDS payment recorded");
      await fetchReport();
    } catch (e) {
      const err = e as Error & { code?: string };
      const m = err.message || "Failed to pay TDS";
      const withCode = err.code ? `${m} (${err.code})` : m;
      setError(withCode);
      toastError(withCode);
    } finally {
      setPaying(false);
    }
  }

  function onExportCsv() {
    if (!report.export || !report.export.headers?.length || !report.export.rows?.length) {
      setError("No export data available.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        report.export.headers.map((h) => esc(h)).join(","),
        ...report.export.rows.map((row) =>
          report.export!.headers.map((h) => esc(row[h])).join(",")
        ),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nexfernCsvFilename("tds_report");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      success("CSV exported.");
    } finally {
      setExporting(false);
    }
  }

  const totalDeductionsCount = report.vendorSummary.reduce((sum, v) => sum + (v.deductionsCount || 0), 0);
  const vendorsCount = report.vendorSummary.length;

  return (
    <Container className="py-10">
      <div>
        <div className="text-sm font-semibold text-slate-500">Compliance</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">TDS Management</h1>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card padding="sm" className="!p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total TDS payable</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums text-orange-600">{fmt(report.totalTds)}</div>
        </Card>
        <Card padding="sm" className="!p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions count</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{totalDeductionsCount}</div>
        </Card>
        <Card padding="sm" className="!p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendors</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{vendorsCount}</div>
        </Card>
      </div>

      <Card className="mt-4 !p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-600">Pay amount (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-10 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </label>
            <Button
              variant="primary"
              onClick={() => setPayConfirmOpen(true)}
              disabled={paying || loading || exporting}
            >
              Pay TDS
            </Button>
          </div>
          <Button
            variant="secondary"
            className="font-semibold shadow-sm"
            onClick={onExportCsv}
            disabled={loading || exporting || !report.export?.rows?.length}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </Card>

      {message ? (
        <div className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700 ring-1 ring-inset ring-green-200">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      <ConfirmModal
        open={payConfirmOpen}
        title="Record TDS payment?"
        message={
          <>
            Pay <span className="font-bold text-slate-900">{fmt(Number(payAmount) || 0)}</span> against TDS liability?
            This records the payment in the system.
          </>
        }
        confirmLabel="Confirm payment"
        loading={paying}
        onCancel={() => !paying && setPayConfirmOpen(false)}
        onConfirm={() => {
          setPayConfirmOpen(false);
          void onPay();
        }}
      />

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="px-6 py-4 text-sm font-semibold text-slate-600">Vendor-wise TDS summary</div>
        {loading ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : report.vendorSummary.length === 0 ? (
          <div className="px-6 pb-8">
            <EmptyState title="No vendor summary" description="TDS will appear when expenses include TDS." />
          </div>
        ) : (
          <TableWrap className="max-h-[min(50vh,400px)] overflow-y-auto rounded-none border-t border-slate-100 ring-0">
            <Table zebra>
              <THead>
                <tr>
                  <Th>Vendor</Th>
                  <Th>GST</Th>
                  <Th align="right">Base</Th>
                  <Th align="right">TDS</Th>
                  <Th align="right">Count</Th>
                </tr>
              </THead>
              <TBody>
                {report.vendorSummary.map((v) => (
                  <tr key={`${v.vendorId ?? "unassigned"}-${v.vendorName}`}>
                    <Td className="font-semibold text-slate-900">{v.vendorName}</Td>
                    <Td className="text-slate-600">{v.vendorGstNumber || "—"}</Td>
                    <Td align="right">{fmt(v.totalBaseAmount)}</Td>
                    <Td align="right" className="font-semibold text-orange-600">{fmt(v.totalTds)}</Td>
                    <Td align="right">{v.deductionsCount}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="px-6 py-4 text-sm font-semibold text-slate-600">TDS deductions</div>
        {loading ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : report.records.length === 0 ? (
          <div className="px-6 pb-8">
            <EmptyState title="No deductions yet" />
          </div>
        ) : (
          <TableWrap className="max-h-[min(50vh,400px)] overflow-y-auto rounded-none border-t border-slate-100 ring-0">
            <Table zebra>
              <THead>
                <tr>
                  <Th>Vendor</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">TDS</Th>
                  <Th>Date</Th>
                </tr>
              </THead>
              <TBody>
                {report.records.map((r) => (
                  <tr key={r.expenseId}>
                    <Td className="font-semibold text-slate-900">{r.vendorName}</Td>
                    <Td align="right">{fmt(r.amount)}</Td>
                    <Td align="right" className="font-semibold text-orange-600">{fmt(r.tdsAmount)}</Td>
                    <Td className="text-slate-600">
                      {r.date ? new Date(r.date).toLocaleDateString("en-IN") : "—"}
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>
    </Container>
  );
}
