import * as React from "react";
import { apiFetch, getStoredToken } from "@/api";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { VirtualizedTable, type VirtualTableColumn } from "@/components/VirtualizedTable";
import { inputClassName } from "@/components/ui/Input";
import { InlineSpinner } from "@/components/ui/Spinner";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/context/ToastContext";
import { useFirstFieldFocus, createFormEnterSubmitHandler } from "@/hooks/useFormEnhancements";
import { jsPDF } from "jspdf";

type Employee = {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  basicSalary: number;
  allowances: number;
  deductions: number;
  tds?: number;
  pfAmount?: number;
  esiAmount?: number;
  salary: number;
};

type Payslip = {
  _id: string;
  employeeId?: { _id: string; name: string; email: string; role: string } | null;
  month: string;
  gross: number;
  deductions: number;
  tds?: number;
  pfAmount?: number;
  esiAmount?: number;
  net: number;
  generatedAt: string;
};

type PayrollSummary = {
  month: string | null;
  /** Payslips in scope (legacy field name was overloaded) */
  totalEmployees: number;
  payslipCount?: number;
  activeEmployeeCount?: number;
  totals: {
    gross: number;
    deductions: number;
    tds: number;
    pfAmount: number;
    esiAmount: number;
    net: number;
  };
};

function fmt(n: number) {
  return formatCurrency(n || 0);
}

type EmpSortKey = "name" | "basicSalary" | "salary";

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

function PayrollInner() {
  const { success, error: toastError } = useToast();
  const formEnterSubmit = React.useMemo(() => createFormEnterSubmitHandler(), []);
  const token = getStoredToken();
  const role = typeof window !== "undefined" ? window.localStorage.getItem("role") : null;
  const canRun = role === "admin" || role === "accountant";

  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [payslips, setPayslips] = React.useState<Payslip[]>([]);
  const [summary, setSummary] = React.useState<PayrollSummary>({
    month: null,
    totalEmployees: 0,
    totals: { gross: 0, deductions: 0, tds: 0, pfAmount: 0, esiAmount: 0, net: 0 },
  });
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [savingEmp, setSavingEmp] = React.useState(false);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState(() => new Date().toISOString().slice(0, 7));

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [empRole, setEmpRole] = React.useState("employee");
  const [joiningDate, setJoiningDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [basicSalary, setBasicSalary] = React.useState("");
  const [allowances, setAllowances] = React.useState("0");
  const [deductions, setDeductions] = React.useState("0");
  const [tds, setTds] = React.useState("0");
  const [pfAmount, setPfAmount] = React.useState("0");
  const [esiAmount, setEsiAmount] = React.useState("0");

  const nameFieldRef = useFirstFieldFocus<HTMLInputElement>(canRun);
  const [empSort, setEmpSort] = React.useState<{ key: EmpSortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  const payslipCountForMonth = summary.payslipCount ?? summary.totalEmployees;
  const activeEmployeeCount =
    summary.activeEmployeeCount ?? employees.filter((e) => e.isActive).length;

  async function loadData(selectedMonth = month) {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [emp, slips, summaryRes] = await Promise.all([
        apiFetch<Employee[]>("/payroll/employees", { token }),
        apiFetch<Payslip[]>(`/payroll?month=${encodeURIComponent(selectedMonth)}`, { token }),
        apiFetch<PayrollSummary>(`/payroll/summary?month=${encodeURIComponent(selectedMonth)}`, { token }),
      ]);
      setEmployees(Array.isArray(emp) ? emp : []);
      setPayslips(Array.isArray(slips) ? slips : []);
      setSummary(summaryRes);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to load payroll data";
      setError(m);
      toastError(m);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadData(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function onRunPayroll() {
    if (!token) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ processedCount: number; skippedCount: number; month: string; errors?: Array<{ message?: string }> }>("/payroll/run", {
        method: "POST",
        token,
        body: JSON.stringify({ month }),
      });
      const errNote = res.errors && res.errors.length > 0 ? `, errors ${res.errors.length}` : "";
      setMessage(`Payroll run completed for ${res.month}: processed ${res.processedCount}, skipped ${res.skippedCount}${errNote}`);
      success("Payroll run finished.");
      await loadData(month);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payroll run failed";
      setError(m);
      toastError(m);
    } finally {
      setRunning(false);
    }
  }

  async function onCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const basic = Number(basicSalary);
    const alw = Number(allowances);
    const ded = Number(deductions);
    const tdsNum = Number(tds);
    const pfNum = Number(pfAmount);
    const esiNum = Number(esiAmount);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (
      !Number.isFinite(basic) || basic < 0 ||
      !Number.isFinite(alw) || alw < 0 ||
      !Number.isFinite(ded) || ded < 0 ||
      !Number.isFinite(tdsNum) || tdsNum < 0 ||
      !Number.isFinite(pfNum) || pfNum < 0 ||
      !Number.isFinite(esiNum) || esiNum < 0
    ) {
      setError("Salary fields must be non-negative numbers.");
      return;
    }

    setSavingEmp(true);
    setError(null);
    try {
      await apiFetch<Employee>("/payroll/employees", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role: empRole.trim(),
          joiningDate,
          basicSalary: basic,
          allowances: alw,
          deductions: ded,
          tds: tdsNum,
          pfAmount: pfNum,
          esiAmount: esiNum,
        }),
      });
      setName("");
      setEmail("");
      setEmpRole("employee");
      setBasicSalary("");
      setAllowances("0");
      setDeductions("0");
      setTds("0");
      setPfAmount("0");
      setEsiAmount("0");
      success("Employee added.");
      await loadData(month);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to create employee";
      setError(m);
      toastError(m);
    } finally {
      setSavingEmp(false);
    }
  }

  const onDownloadPayslip = React.useCallback(async (p: Payslip) => {
    setDownloadingId(p._id);
    try {
      const doc = new jsPDF();
      const employeeName = p.employeeId?.name ?? "-";
      const pageW = doc.internal.pageSize.getWidth();
      let y = 18;
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text("Nexfern — Payslip", 14, y);
      doc.setFontSize(9);
      doc.text(`Generated ${new Date(p.generatedAt).toLocaleString("en-IN")}`, 14, y + 7);
      doc.setTextColor(0, 0, 0);
      y = 40;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(employeeName, 14, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Period: ${p.month}`, 14, y + 7);
      doc.setDrawColor(226, 232, 240);
      doc.line(14, y + 12, pageW - 14, y + 12);
      y += 22;
      const rows: [string, string][] = [
        ["Gross pay", fmt(p.gross)],
        ["TDS", fmt(p.tds ?? 0)],
        ["PF", fmt(p.pfAmount ?? 0)],
        ["ESI", fmt(p.esiAmount ?? 0)],
        ["Total deductions", fmt(p.deductions)],
        ["Net pay", fmt(p.net)],
      ];
      doc.setFontSize(10);
      for (const [label, val] of rows) {
        doc.setTextColor(71, 85, 105);
        doc.text(label, 14, y);
        doc.setTextColor(15, 23, 42);
        doc.text(val, pageW - 14, y, { align: "right" });
        y += 7;
      }
      doc.save(`payslip-${employeeName.replace(/\s+/g, "-").toLowerCase()}-${p.month}.pdf`);
      success("Payslip downloaded.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "PDF failed");
    } finally {
      setDownloadingId(null);
    }
  }, [success, toastError]);

  const sortedEmployees = React.useMemo(() => {
    const list = [...employees];
    const { key, dir } = empSort;
    const mul = dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (key === "name") return mul * a.name.localeCompare(b.name);
      const av = key === "basicSalary" ? a.basicSalary : a.salary;
      const bv = key === "basicSalary" ? b.basicSalary : b.salary;
      return mul * (av - bv);
    });
    return list;
  }, [employees, empSort]);

  const toggleEmpSort = React.useCallback((key: EmpSortKey) => {
    setEmpSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }, []);

  const monthOptions = React.useMemo(() => {
    const now = new Date();
    const last12 = Array.from({ length: 12 }).map((_, idx) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - idx, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const fromPayslips = payslips.map((p) => p.month).filter(Boolean);
    return [...new Set([month, ...last12, ...fromPayslips])].sort().reverse();
  }, [month, payslips]);

  const nameOk = name.trim().length > 0;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const basicParsed = Number(basicSalary);
  const basicOk = Number.isFinite(basicParsed) && basicParsed >= 0 && basicSalary.trim().length > 0;

  const employeeColumns = React.useMemo((): VirtualTableColumn<Employee>[] => {
    const sortBtn = (label: string, key: EmpSortKey) => (
      <button
        type="button"
        className="font-bold uppercase tracking-wide text-slate-500 hover:text-primary"
        onClick={() => toggleEmpSort(key)}
      >
        {label}
        {empSort.key === key ? (empSort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    );
    return [
      {
        id: "name",
        header: sortBtn("Name", "name"),
        width: "minmax(120px,1.2fr)",
        cell: (e) => <span className="font-semibold text-slate-900">{e.name}</span>,
      },
      {
        id: "email",
        header: "Email",
        width: "minmax(140px,1fr)",
        hideBelowMd: true,
        cell: (e) => <span className="text-slate-700">{e.email}</span>,
      },
      {
        id: "role",
        header: "Role",
        width: "100px",
        hideBelowMd: true,
        cell: (e) => <span className="text-slate-700">{e.role}</span>,
      },
      {
        id: "basic",
        header: sortBtn("Basic", "basicSalary"),
        align: "right",
        width: "100px",
        cell: (e) => fmt(e.basicSalary),
      },
      {
        id: "allow",
        header: "Allow.",
        align: "right",
        width: "92px",
        hideBelowLg: true,
        cell: (e) => fmt(e.allowances),
      },
      {
        id: "ded",
        header: "Ded.",
        align: "right",
        width: "92px",
        hideBelowLg: true,
        cell: (e) => fmt(e.deductions),
      },
      {
        id: "tds",
        header: "TDS",
        align: "right",
        width: "88px",
        hideBelowLg: true,
        cell: (e) => fmt(e.tds ?? 0),
      },
      {
        id: "pf",
        header: "PF",
        align: "right",
        width: "88px",
        hideBelowLg: true,
        cell: (e) => fmt(e.pfAmount ?? 0),
      },
      {
        id: "esi",
        header: "ESI",
        align: "right",
        width: "88px",
        hideBelowLg: true,
        cell: (e) => fmt(e.esiAmount ?? 0),
      },
      {
        id: "net",
        header: sortBtn("Net", "salary"),
        align: "right",
        width: "110px",
        cell: (e) => <span className="font-semibold text-primary">{fmt(e.salary)}</span>,
      },
      {
        id: "status",
        header: "Status",
        width: "88px",
        cell: (e) => <span className="text-slate-700">{e.isActive ? "Active" : "Inactive"}</span>,
      },
    ];
  }, [empSort, toggleEmpSort]);

  const payslipColumns = React.useMemo((): VirtualTableColumn<Payslip>[] => {
    return [
      {
        id: "emp",
        header: "Employee",
        width: "minmax(120px,1.2fr)",
        cell: (p) => <span className="font-semibold text-slate-900">{p.employeeId?.name ?? "-"}</span>,
      },
      {
        id: "month",
        header: "Month",
        width: "100px",
        cell: (p) => <span className="text-slate-700">{p.month}</span>,
      },
      {
        id: "gross",
        header: "Gross",
        align: "right",
        width: "100px",
        cell: (p) => fmt(p.gross),
      },
      {
        id: "tds",
        header: "TDS",
        align: "right",
        width: "88px",
        hideBelowMd: true,
        cell: (p) => fmt(p.tds ?? 0),
      },
      {
        id: "pf",
        header: "PF",
        align: "right",
        width: "88px",
        hideBelowMd: true,
        cell: (p) => fmt(p.pfAmount ?? 0),
      },
      {
        id: "esi",
        header: "ESI",
        align: "right",
        width: "88px",
        hideBelowMd: true,
        cell: (p) => fmt(p.esiAmount ?? 0),
      },
      {
        id: "net",
        header: "Net",
        align: "right",
        width: "110px",
        cell: (p) => <span className="font-semibold text-primary">{fmt(p.net)}</span>,
      },
      {
        id: "gen",
        header: "Generated",
        width: "minmax(140px,1fr)",
        hideBelowLg: true,
        cell: (p) => (
          <span className="text-xs text-slate-600">
            {p.generatedAt ? new Date(p.generatedAt).toLocaleString("en-IN") : "-"}
          </span>
        ),
      },
      {
        id: "pdf",
        header: "PDF",
        width: "132px",
        cell: (p) => (
          <Button
            variant="secondary"
            size="sm"
            className="inline-flex min-w-30 items-center justify-center gap-2"
            disabled={downloadingId === p._id}
            aria-busy={downloadingId === p._id}
            onClick={() => void onDownloadPayslip(p)}
          >
            {downloadingId === p._id ? <InlineSpinner label="Generating PDF" /> : null}
            {downloadingId === p._id ? "Downloading…" : "Download"}
          </Button>
        ),
      },
    ];
  }, [downloadingId, onDownloadPayslip]);

  return (
    <Container className="px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">Payroll</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Employee Salary System</h1>
        </div>
        <div className="flex items-end gap-3 self-end">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-600">Month</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          {canRun ? (
            <Button
              variant="primary"
              onClick={() => void onRunPayroll()}
              disabled={running || loading || activeEmployeeCount === 0}
            >
              {running ? "Running..." : "Run Payroll"}
            </Button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700 ring-1 ring-inset ring-green-200">{message}</div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}
      {activeEmployeeCount === 0 ? (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
          No active employees on file — add employees before running payroll
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active employees</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">{activeEmployeeCount}</div>
          <div className="mt-1 text-xs text-slate-400">Payslips ({month}): {payslipCountForMonth}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gross</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">{fmt(summary.totals.gross)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">{fmt(summary.totals.deductions)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">TDS</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-orange-600">{fmt(summary.totals.tds)}</div>
        </Card>
        <Card className="p-4 sm:col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net pay</div>
          <div className="mt-1 text-2xl font-extrabold tabular-nums text-primary">{fmt(summary.totals.net)}</div>
        </Card>
      </div>

      {canRun ? (
        <form
          onSubmit={onCreateEmployee}
          onKeyDown={formEnterSubmit}
          className="mt-6 space-y-6 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-inset ring-slate-200 md:p-6"
        >
          <div className="text-sm font-extrabold text-slate-900">Add employee</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-100 sm:col-span-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Profile</div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Name <span className="text-red-500">*</span>
                  </span>
                  <input
                    ref={nameFieldRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    required
                    className={cx(inputClassName, !nameOk && name.length > 0 ? "ring-1 ring-red-200" : "")}
                  />
                  {!nameOk && name.length > 0 ? <p className="text-xs font-medium text-red-600">Name is required.</p> : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Email <span className="text-red-500">*</span>
                  </span>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="name@company.com"
                    required
                    className={cx(inputClassName, email.length > 0 && !emailOk ? "ring-1 ring-red-200" : "")}
                  />
                  {email.length > 0 && !emailOk ? (
                    <p className="text-xs font-medium text-red-600">Enter a valid email address.</p>
                  ) : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">Role</span>
                  <input value={empRole} onChange={(e) => setEmpRole(e.target.value)} placeholder="Role" className={inputClassName} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">Joining date</span>
                  <input value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} type="date" className={inputClassName} />
                </label>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-100 sm:col-span-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Salary structure (₹)</div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Basic <span className="text-red-500">*</span>
                  </span>
                  <input
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    required
                    className={cx(inputClassName, basicSalary.length > 0 && !basicOk ? "ring-1 ring-red-200" : "")}
                  />
                  {basicSalary.length > 0 && !basicOk ? (
                    <p className="text-xs font-medium text-red-600">Enter a non-negative number.</p>
                  ) : null}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">Allowances</span>
                  <input value={allowances} onChange={(e) => setAllowances(e.target.value)} type="number" min={0} step="0.01" placeholder="0" className={inputClassName} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">Other deductions</span>
                  <input value={deductions} onChange={(e) => setDeductions(e.target.value)} type="number" min={0} step="0.01" placeholder="0" className={inputClassName} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">TDS</span>
                  <input value={tds} onChange={(e) => setTds(e.target.value)} type="number" min={0} step="0.01" placeholder="0" className={inputClassName} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">PF</span>
                  <input value={pfAmount} onChange={(e) => setPfAmount(e.target.value)} type="number" min={0} step="0.01" placeholder="0" className={inputClassName} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-600">ESI</span>
                  <input value={esiAmount} onChange={(e) => setEsiAmount(e.target.value)} type="number" min={0} step="0.01" placeholder="0" className={inputClassName} />
                </label>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={savingEmp}>
              {savingEmp ? "Saving..." : "Add employee"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="px-4 py-4 text-sm font-semibold text-slate-600 md:px-6">Employee list</div>
        {loading ? (
          <div className="px-4 pb-6 md:px-6">
            <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : employees.length === 0 ? (
          <div className="px-4 pb-8 md:px-6">
            <EmptyState title="No employees" description="Add an employee to run payroll." />
          </div>
        ) : (
          <VirtualizedTable
            rows={sortedEmployees}
            columns={employeeColumns}
            rowKey={(e) => e._id}
            rowHeight={52}
            minTableWidth={1100}
            maxHeight={480}
          />
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="px-4 py-4 text-sm font-semibold text-slate-600 md:px-6">Payslips</div>
        {loading ? (
          <div className="px-4 pb-6 md:px-6">
            <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            <div className="mt-2 h-10 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : payslips.length === 0 ? (
          <div className="px-4 pb-8 md:px-6">
            <EmptyState title="No payslips for this month" description="Run payroll to generate payslips." />
          </div>
        ) : (
          <VirtualizedTable
            rows={payslips}
            columns={payslipColumns}
            rowKey={(p) => p._id}
            rowHeight={56}
            minTableWidth={960}
            maxHeight={480}
          />
        )}
      </div>
    </Container>
  );
}

export const Payroll = React.memo(PayrollInner);
