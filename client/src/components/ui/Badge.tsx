import * as React from "react";

const variants = {
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  neutral: "bg-slate-50 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
} as const;

export type BadgeVariant = keyof typeof variants;

export function Badge({
  children,
  variant = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
