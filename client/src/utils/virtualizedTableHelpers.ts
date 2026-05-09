import type { VirtualTableColumn } from "@/types/virtualizedTable";

export function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function alignClass(a: "left" | "right" | "center" | undefined): string {
  if (a === "right") return "text-right";
  if (a === "center") return "text-center";
  return "text-left";
}

export function cellHideClass(c: VirtualTableColumn<unknown>): string {
  if (c.hideBelowLg) return "hidden lg:table-cell";
  if (c.hideBelowMd) return "hidden md:table-cell";
  return "";
}
