import * as React from "react";

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function TableWrap({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-x-auto rounded-xl ring-1 ring-inset ring-slate-200", className)}>
      {children}
    </div>
  );
}

type TableProps = {
  children: React.ReactNode;
  zebra?: boolean;
  className?: string;
};

export function Table({ children, zebra, className }: TableProps) {
  return (
    <table
      className={cx(
        "min-w-full border-collapse text-sm",
        zebra && "[&_tbody_tr:nth-child(even)]:bg-slate-50/80",
        className
      )}
    >
      {children}
    </table>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
      {children}
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={cx(
        "whitespace-nowrap px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500",
        a,
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a = align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left";
  return <td className={cx("px-4 py-3 align-middle text-slate-800", a, className)}>{children}</td>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}
