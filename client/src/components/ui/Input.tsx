import * as React from "react";

const base =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";

export const inputClassName = base;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${base} ${className}`} {...rest} />;
}

export function FieldError({
  children,
  message,
}: {
  children?: React.ReactNode;
  /** Alias for children — use one or the other */
  message?: React.ReactNode;
}) {
  const content = message ?? children;
  if (!content) return null;
  return <p className="mt-1 text-xs font-semibold text-red-600">{content}</p>;
}
