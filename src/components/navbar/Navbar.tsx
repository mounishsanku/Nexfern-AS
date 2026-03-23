"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/invoices", label: "Invoices" },
  { href: "/expenses", label: "Expenses" },
  { href: "/reports", label: "Reports" },
] as const;

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

function NavItem({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cx(
        "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      {label}
    </Link>
  );
}

export function Navbar() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <Container className="py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-xl px-2 py-1 text-lg font-extrabold tracking-tight text-slate-900 hover:bg-slate-100"
            >
              <span className="text-primary">Nex</span>fern
            </Link>
          </div>

          <nav className="hidden items-center justify-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavItem key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <Button href="/login" variant="primary">
                Login
              </Button>
            </div>

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
              <div className="grid gap-1">
                {navItems.map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </div>
              <div className="mt-2 border-t border-slate-200/70 pt-2">
                <Button
                  href="/login"
                  variant="primary"
                  className="w-full justify-center"
                >
                  Login
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Container>
    </header>
  );
}

