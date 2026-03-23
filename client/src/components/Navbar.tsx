import * as React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { ConfirmModal } from "@/components/ui/Modal";
import { getStoredRole, hasStoredPermission, type Role } from "@/components/RoleProtectedRoute";

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

type NavItem = { to: string; label: string };

/** Grouped for clarity; each array is rendered with a subtle separator. */
const navGroupsByRole: Record<Role, NavItem[][]> = {
  admin: [
    [{ to: "/dashboard", label: "Dashboard" }],
    [
      { to: "/invoices", label: "Invoices" },
      { to: "/expenses", label: "Expenses" },
    ],
    [
      { to: "/accounts", label: "Accounts" },
      { to: "/opening-balances", label: "Opening" },
      { to: "/vouchers", label: "Vouchers" },
      { to: "/bank-reconciliation", label: "Bank recon" },
    ],
    [
      { to: "/reports", label: "Reports" },
      { to: "/payroll", label: "Payroll" },
      { to: "/tds", label: "TDS" },
    ],
    [
      { to: "/diagnostics", label: "Diagnostics" },
      { to: "/audit", label: "Audit" },
    ],
  ],
  accountant: [
    [{ to: "/dashboard", label: "Dashboard" }],
    [
      { to: "/invoices", label: "Invoices" },
      { to: "/expenses", label: "Expenses" },
    ],
    [
      { to: "/accounts", label: "Accounts" },
      { to: "/opening-balances", label: "Opening" },
      { to: "/vouchers", label: "Vouchers" },
      { to: "/bank-reconciliation", label: "Bank recon" },
    ],
    [
      { to: "/reports", label: "Reports" },
      { to: "/payroll", label: "Payroll" },
      { to: "/tds", label: "TDS" },
    ],
    [{ to: "/diagnostics", label: "Diagnostics" }],
  ],
  auditor: [
    [{ to: "/reports", label: "Reports" }],
    [
      { to: "/invoices", label: "Invoices" },
      { to: "/expenses", label: "Expenses" },
    ],
    [
      { to: "/accounts", label: "Accounts" },
      { to: "/opening-balances", label: "Opening" },
    ],
    [
      { to: "/payroll", label: "Payroll" },
      { to: "/tds", label: "TDS" },
    ],
    [
      { to: "/diagnostics", label: "Diagnostics" },
      { to: "/audit", label: "Audit" },
    ],
  ],
  receptionist: [
    [
      { to: "/invoices", label: "Invoices" },
      { to: "/expenses", label: "Expenses" },
    ],
  ],
};

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = React.useState(false);
  const [logoutOpen, setLogoutOpen] = React.useState(false);
  const [isLoggedIn, setIsLoggedIn] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.localStorage.getItem("token"));
  });
  const [role, setRole] = React.useState<Role>(() => getStoredRole());

  React.useEffect(() => {
    setIsLoggedIn(Boolean(window.localStorage.getItem("token")));
    setRole(getStoredRole());
    setOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("role");
    window.localStorage.removeItem("permissions");
    setIsLoggedIn(false);
    setRole("receptionist");
    setOpen(false);
    setLogoutOpen(false);
    navigate("/login", { replace: true });
  }

  const navGroups = isLoggedIn ? navGroupsByRole[role] : [];
  const filteredNavGroups = navGroups
    .map((group) =>
      group.filter((item) => {
        if (item.to === "/payroll") return hasStoredPermission("PAYROLL_MANAGE");
        if (item.to === "/tds") return hasStoredPermission("TDS_MANAGE");
        return true;
      })
    )
    .filter((g) => g.length > 0);
  const homePath = role === "admin" || role === "accountant" ? "/dashboard" : role === "auditor" ? "/reports" : "/invoices";

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <Container className="py-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            to={isLoggedIn ? homePath : "/login"}
            className="rounded-xl px-2 py-1 text-lg font-extrabold tracking-tight text-slate-900 hover:bg-slate-100"
          >
            <span className="text-primary">Nex</span>fern
          </Link>

          <nav className="hidden flex-wrap items-center justify-center gap-x-0 gap-y-1 md:flex lg:max-w-[70vw]">
            {filteredNavGroups.map((group, gi) => (
              <React.Fragment key={gi}>
                {gi > 0 ? (
                  <span className="mx-1 hidden h-6 w-px bg-slate-200 lg:inline-block" aria-hidden />
                ) : null}
                <div className="flex flex-wrap items-center gap-1">
                  {group.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cx(
                          "rounded-xl px-2.5 py-2 text-sm font-semibold transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                        )
                      }
                      end={item.to === "/dashboard"}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!isLoggedIn ? (
              <div className="hidden md:block">
                <Button to="/login" variant="primary">
                  Login
                </Button>
              </div>
            ) : (
              <div className="hidden md:block">
                <Button variant="secondary" onClick={() => setLogoutOpen(true)}>
                  Logout
                </Button>
              </div>
            )}

            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset ring-slate-200 hover:bg-slate-100 md:hidden"
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="relative h-4 w-5">
                <span
                  className={cx(
                    "absolute left-0 top-0 h-0.5 w-5 rounded bg-slate-700 transition-transform",
                    open ? "translate-y-[7px] rotate-45" : "",
                  )}
                />
                <span
                  className={cx(
                    "absolute left-0 top-[7px] h-0.5 w-5 rounded bg-slate-700 transition-opacity",
                    open ? "opacity-0" : "opacity-100",
                  )}
                />
                <span
                  className={cx(
                    "absolute left-0 top-[14px] h-0.5 w-5 rounded bg-slate-700 transition-transform",
                    open ? "translate-y-[-7px] -rotate-45" : "",
                  )}
                />
              </span>
            </button>
          </div>
        </div>

        {open ? (
          <div className="md:hidden">
            <div className="mt-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-inset ring-slate-200 shadow-soft">
              {isLoggedIn ? (
                <>
                  <div className="grid gap-3">
                    {filteredNavGroups.map((group, gi) => (
                      <div key={gi} className="grid gap-1">
                        {group.map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/dashboard"}
                            onClick={() => setOpen(false)}
                            className={({ isActive }) =>
                              cx(
                                "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                                isActive
                                  ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                              )
                            }
                          >
                            {item.label}
                          </NavLink>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 border-t border-slate-200/70 pt-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpen(false);
                        setLogoutOpen(true);
                      }}
                      className="w-full justify-center"
                    >
                      Logout
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-2 border-t border-slate-200/70 pt-2">
                  <Button
                    to="/login"
                    variant="primary"
                    className="w-full justify-center"
                  >
                    Login
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Container>

      <ConfirmModal
        open={logoutOpen}
        title="Sign out?"
        message="You will need to sign in again to access FinanceOS."
        confirmLabel="Logout"
        cancelLabel="Stay signed in"
        danger
        onCancel={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
      />
    </header>
  );
}

