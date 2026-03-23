import { Suspense, lazy } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/app/Layout";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleProtectedRoute, getStoredRole } from "@/components/RoleProtectedRoute";
import { PageSkeleton } from "@/components/ui/Skeleton";

const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Invoices = lazy(() => import("@/pages/Invoices").then((m) => ({ default: m.Invoices })));
const Expenses = lazy(() => import("@/pages/Expenses").then((m) => ({ default: m.Expenses })));
const Reports = lazy(() => import("@/pages/Reports").then((m) => ({ default: m.Reports })));
const ChartOfAccounts = lazy(() =>
  import("@/pages/ChartOfAccounts").then((m) => ({ default: m.ChartOfAccounts }))
);
const OpeningBalances = lazy(() =>
  import("@/pages/OpeningBalances").then((m) => ({ default: m.OpeningBalances }))
);
const BankReconciliation = lazy(() =>
  import("@/pages/BankReconciliation").then((m) => ({ default: m.BankReconciliation }))
);
const Audit = lazy(() => import("@/pages/Audit").then((m) => ({ default: m.Audit })));
const Tds = lazy(() => import("@/pages/Tds").then((m) => ({ default: m.Tds })));
const Payroll = lazy(() => import("@/pages/Payroll").then((m) => ({ default: m.Payroll })));
const SystemDiagnostics = lazy(() =>
  import("@/pages/SystemDiagnostics").then((m) => ({ default: m.SystemDiagnostics }))
);
const Vouchers = lazy(() => import("@/pages/Vouchers").then((m) => ({ default: m.Vouchers })));

function defaultPath() {
  const role = getStoredRole();
  if (role === "admin") return "/dashboard";
  if (role === "auditor") return "/reports";
  return "/invoices";
}

export default function App() {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null;

  return (
    <BrowserRouter>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route element={<Layout />}>
            <Route
              path="/"
              element={<Navigate to={token ? defaultPath() : "/login"} replace />}
            />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            <Route element={<ProtectedRoute />}>
              <Route
                path="/dashboard"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <Dashboard />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/invoices"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "receptionist", "auditor"]}>
                    <Invoices />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/expenses"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor", "receptionist"]}>
                    <Expenses />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor"]}>
                    <Reports />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/accounts"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor"]}>
                    <ChartOfAccounts />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/opening-balances"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor"]}>
                    <OpeningBalances />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/vouchers"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <Vouchers />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/bank-reconciliation"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <BankReconciliation />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/audit"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "auditor"]}>
                    <Audit />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/tds"
                element={
                  <RoleProtectedRoute
                    allowedRoles={["admin", "accountant", "auditor"]}
                    requiredPermission="TDS_MANAGE"
                  >
                    <Tds />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/payroll"
                element={
                  <RoleProtectedRoute
                    allowedRoles={["admin", "accountant", "auditor"]}
                    requiredPermission="PAYROLL_MANAGE"
                  >
                    <Payroll />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/diagnostics"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor"]}>
                    <SystemDiagnostics />
                  </RoleProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
