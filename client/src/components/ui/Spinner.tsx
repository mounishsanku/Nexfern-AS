function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

/** Inline loading indicator for buttons (accessibility: use aria-busy on parent button). */
export function InlineSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-primary",
        className,
      )}
      role={label ? "status" : undefined}
      aria-label={label}
    />
  );
}
