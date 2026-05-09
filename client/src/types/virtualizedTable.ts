import type { ReactNode } from "react";

export type VirtualTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T, rowIndex: number) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  hideBelowMd?: boolean;
  hideBelowLg?: boolean;
};

export type VirtualizedTableProps<T extends object> = {
  rows: T[];
  columns: VirtualTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  threshold?: number;
  rowHeight?: number;
  maxHeight?: number;
  minTableWidth?: number;
  className?: string;
  zebra?: boolean;
};

/** Extra props passed to react-window List rowComponent */
export type VirtualTableRowProps<T> = {
  rows: T[];
  columns: VirtualTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  gridTemplate: string;
  zebra: boolean;
};
