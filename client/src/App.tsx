import { Suspense, lazy } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "@/app/Layout";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";
import { getStoredRole } from "@/utils/roleAuth";
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

// Admin Localization & Settings Routes
const EntitySettings = lazy(() => import("@/pages/EntitySettings").then((m) => ({ default: m.EntitySettings })));
const LocalizationSettings = lazy(() => import("@/pages/LocalizationSettings").then((m) => ({ default: m.LocalizationSettings })));
const CurrencyManagement = lazy(() => import("@/pages/CurrencyManagement").then((m) => ({ default: m.CurrencyManagement })));
const TaxProfiles = lazy(() => import("@/pages/TaxProfiles").then((m) => ({ default: m.TaxProfiles })));
const ImportCenter = lazy(() => import("@/pages/ImportCenter").then((m) => ({ default: m.ImportCenter })));
const SecuritySettings = lazy(() => import("@/pages/SecuritySettings").then((m) => ({ default: m.SecuritySettings })));
const Integrations = lazy(() => import("@/pages/Integrations").then((m) => ({ default: m.Integrations })));
const ReconciliationWorkspace = lazy(() => import("@/pages/ReconciliationWorkspace").then((m) => ({ default: m.ReconciliationWorkspace })));
const AnalyticsDashboard = lazy(() => import("@/pages/AnalyticsDashboard").then((m) => ({ default: m.AnalyticsDashboard })));
const SystemOperations = lazy(() => import("@/pages/SystemOperations").then((m) => ({ default: m.SystemOperations })));
const HelpCenter = lazy(() => import("@/pages/HelpCenter").then((m) => ({ default: m.HelpCenter })));
const GstReconciliation = lazy(() => import("@/pages/GstReconciliation").then((m) => ({ default: m.GstReconciliation })));

function defaultPath() {
  const role = getStoredRole();
  if (role === "admin") return "/dashboard";
  if (role === "auditor") return "/reports";
  return "/invoices";
}

import { LocalizationProvider } from "@/context/LocalizationContext";

export default function App() {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null;

  return (
    <LocalizationProvider>
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
              {/* Admin Localization & Config Routes */}
              <Route
                path="/settings/entities"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <EntitySettings />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/localization"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <LocalizationSettings />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/currencies"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <CurrencyManagement />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/tax-profiles"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <TaxProfiles />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/import"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <ImportCenter />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/security"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <SecuritySettings />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/settings/integrations"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <Integrations />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/reconciliation"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <ReconciliationWorkspace />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/gst-reconciliation"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant", "auditor"]}>
                    <GstReconciliation />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <AnalyticsDashboard />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/ops"
                element={
                  <RoleProtectedRoute allowedRoles={["admin"]}>
                    <SystemOperations />
                  </RoleProtectedRoute>
                }
              />
              <Route
                path="/help"
                element={
                  <RoleProtectedRoute allowedRoles={["admin", "accountant"]}>
                    <HelpCenter />
                  </RoleProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
    </LocalizationProvider>
  );
}
