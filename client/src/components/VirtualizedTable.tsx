import * as React from "react";
import { List, type RowComponentProps } from "react-window";
import type { CSSProperties } from "react";
import { TableWrap, Table, THead, Th, TBody, Td } from "@/components/ui/Table";
import { useContainerWidth } from "@/hooks/useContainerWidth";

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export type VirtualTableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T, rowIndex: number) => React.ReactNode;
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

function alignClass(a: "left" | "right" | "center" | undefined): string {
  if (a === "right") return "text-right";
  if (a === "center") return "text-center";
  return "text-left";
}

function cellHideClass(c: VirtualTableColumn<unknown>): string {
  if (c.hideBelowLg) return "hidden lg:table-cell";
  if (c.hideBelowMd) return "hidden md:table-cell";
  return "";
}

/** Extra props passed to react-window List rowComponent */
export type VirtualTableRowProps<T> = {
  rows: T[];
  columns: VirtualTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  gridTemplate: string;
  zebra: boolean;
};

function VirtualListRow<T extends object>({
  ariaAttributes,
  index,
  style,
  rows,
  columns,
  gridTemplate,
  zebra,
}: RowComponentProps<VirtualTableRowProps<T>>) {
  const row = rows[index];
  return (
    <div
      {...ariaAttributes}
      style={
        {
          ...style,
          display: "grid",
          gridTemplateColumns: gridTemplate,
          alignItems: "center",
          columnGap: "0.5rem",
        } as CSSProperties
      }
      className={cx(
        "border-b border-slate-100 px-2 text-xs sm:text-sm",
        zebra && index % 2 === 1 ? "bg-slate-50/70" : "bg-white",
        "hover:bg-slate-100/80",
      )}
    >
      {columns.map((col) => (
        <div
          key={col.id}
          className={cx(
            "min-w-0 px-1 py-1.5",
            alignClass(col.align),
            col.align === "right" ? "font-mono tabular-nums" : "",
          )}
        >
          {col.cell(row, index)}
        </div>
      ))}
    </div>
  );
}

function VirtualizedTableInner<T extends object>({
  rows,
  columns,
  rowKey,
  threshold = 200,
  rowHeight = 52,
  maxHeight = 560,
  minTableWidth = 960,
  className,
  zebra = true,
}: VirtualizedTableProps<T>) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const gridTemplate = React.useMemo(
    () => columns.map((c) => c.width ?? "minmax(0,1fr)").join(" "),
    [columns],
  );

  const listHeight = Math.min(maxHeight, Math.max(rows.length * rowHeight, rowHeight));
  const useVirtual = rows.length > threshold;

  const rowProps = React.useMemo(
    () => ({ rows, columns, rowKey, gridTemplate, zebra }),
    [rows, columns, rowKey, gridTemplate, zebra],
  );

  if (rows.length === 0) return null;

  if (!useVirtual) {
    return (
      <TableWrap
        className={cx(
          "max-h-[min(70vh,560px)] overflow-y-auto overflow-x-auto rounded-none border-t border-slate-100 ring-0",
          className,
        )}
      >
        <Table zebra={zebra} className="min-w-[720px] text-xs sm:text-sm">
          <THead>
            <tr>
              {columns.map((col) => (
                <Th
                  key={col.id}
                  align={col.align ?? "left"}
                  className={cx(cellHideClass(col as VirtualTableColumn<unknown>))}
                >
                  {col.header}
                </Th>
              ))}
            </tr>
          </THead>
          <TBody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className="transition-colors hover:bg-slate-50/90"
              >
                {columns.map((col) => (
                  <Td
                    key={col.id}
                    align={col.align ?? "left"}
                    className={cx(
                      cellHideClass(col as VirtualTableColumn<unknown>),
                      "py-3",
                      col.align === "right" ? "font-mono" : "",
                    )}
                  >
                    {col.cell(row, index)}
                  </Td>
                ))}
              </tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    );
  }

  const listW = width > 0 ? width : minTableWidth;

  const RowComponent = React.useCallback(
    (props: RowComponentProps<VirtualTableRowProps<T>>) => (
      <VirtualListRow<T> {...props} />
    ),
    [],
  );

  return (
    <div
      ref={widthRef}
      className={cx("w-full overflow-x-auto rounded-none border-t border-slate-100", className)}
    >
      <div style={{ minWidth: minTableWidth }} className="inline-block min-w-full align-top">
        <div
          className="sticky top-0 z-20 grid border-b border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)] sm:text-sm"
          style={{ gridTemplateColumns: gridTemplate, columnGap: "0.5rem" }}
        >
          {columns.map((col) => (
            <div key={col.id} className={cx("min-w-0 px-1 py-2.5", alignClass(col.align))}>
              {col.header}
            </div>
          ))}
        </div>
        <List<VirtualTableRowProps<T>>
          rowCount={rows.length}
          rowHeight={rowHeight}
          rowComponent={RowComponent}
          rowProps={rowProps}
          overscanCount={6}
          style={{ height: listHeight, width: listW }}
        />
      </div>
    </div>
  );
}

export function VirtualizedTable<T extends object>(props: VirtualizedTableProps<T>) {
  return <VirtualizedTableInner {...props} />;
}
