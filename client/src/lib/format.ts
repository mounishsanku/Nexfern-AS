/** Consistent INR formatting with ₹ symbol and grouping */
export function formatCurrency(
  n: number,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (!Number.isFinite(n)) return "—";
  const min = opts?.minimumFractionDigits ?? 0;
  const max = opts?.maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
}

export function formatDateTime(d: Date = new Date()): string {
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
