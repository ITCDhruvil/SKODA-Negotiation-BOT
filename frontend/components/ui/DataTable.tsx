import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide this column below the `md` breakpoint. */
  hideOnMobile?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = "Nothing to show.",
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
}) {
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const pad = dense ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line2 bg-raise text-xs font-semibold text-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${pad} ${align(c.align)} whitespace-nowrap ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line2 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-raise" : ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${pad} ${align(c.align)} align-middle ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.className ?? ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
