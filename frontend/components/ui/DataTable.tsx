"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { PAGE_SIZES, Pagination } from "./Pagination";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Makes the header clickable: the value rows are ordered by. Leave out for columns that should not sort. */
  sort?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide this column below the `md` breakpoint. */
  hideOnMobile?: boolean;
  /** Hide this column below the `xl` breakpoint (for secondary columns of wide tables). */
  hideBelowXl?: boolean;
};

type Dir = "asc" | "desc";

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // empty values always last
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = "Nothing to show.",
  dense = false,
  defaultSort,
  paginate = false,
  noun,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
  /** Column key and direction to start with; without it rows keep the order they arrive in. */
  defaultSort?: { key: string; dir: Dir };
  /** Show the page footer (rows per page, page buttons). Sorting applies to all rows before they are paged. */
  paginate?: boolean;
  /** Plural name for what the rows are, used in "Showing 1–10 of 85 events". */
  noun?: string;
}) {
  const [page, setPage] = useState(1);
  // "auto" fits as many rows as the screen height allows; otherwise a fixed number. The choice is remembered.
  const [mode, setMode] = useState<string>("auto");
  const [fit, setFit] = useState<number>(PAGE_SIZES[0]);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("pageSize");
      if (saved === "auto" || (PAGE_SIZES as readonly number[]).includes(Number(saved))) setMode(saved as string);
    } catch {
      /* storage may be blocked */
    }
  }, []);
  const pageSize = mode === "auto" ? fit : Number(mode);
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(defaultSort ?? null);
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const pad = dense ? "px-3 py-2" : "px-4 py-3";

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sort) return rows;
    const get = col.sort;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      const aNull = a == null || a === "";
      const bNull = b == null || b === "";
      if (aNull || bNull) return compare(a, b); // keep empties at the bottom in both directions
      return sign * compare(a, b);
    });
  }, [rows, sort, columns]);

  // Work out how many rows fit between the top of the table and the bottom of the window.
  useEffect(() => {
    if (!paginate || mode !== "auto") return;
    const measure = () => {
      const el = wrap.current;
      if (!el) return;
      // Inside another page the frame grows with its content, so "fit the window" would show every row: use a fixed page.
      if (document.documentElement.dataset.embed === "1") return setFit(10);
      const row = el.querySelector("tbody tr");
      const head = el.querySelector("thead");
      const rowH = row && row.getBoundingClientRect().height > 20 ? row.getBoundingClientRect().height : dense ? 40 : 56;
      const top = el.getBoundingClientRect().top + window.scrollY + (head?.getBoundingClientRect().height ?? 40);
      const footer = 72; // the pagination bar
      const room = window.innerHeight - top - footer - 16;
      setFit(Math.min(100, Math.max(5, Math.floor(room / rowH))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [paginate, mode, dense, rows.length]);

  // New data or a new order starts again on page one; a shorter list never leaves you past its end.
  useEffect(() => setPage(1), [rows.length, sort, pageSize]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const shown = paginate ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted;

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  return (
    <>
    <div ref={wrap} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line2 bg-raise text-xs font-semibold text-muted">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined}
                  className={`${pad} ${align(c.align)} whitespace-nowrap align-middle ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.hideBelowXl ? "hidden xl:table-cell" : ""} ${c.className ?? ""}`}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={`group inline-flex items-center gap-1 rounded-chip font-semibold hover:text-ink ${c.align === "right" ? "flex-row-reverse" : ""} ${c.align === "center" ? "justify-center pl-[17px]" : ""} ${active ? "text-ink" : ""}`}
                    >
                      {c.header}
                      <Icon
                        name={active ? (sort!.dir === "asc" ? "up" : "down") : "sort"}
                        size={13}
                        className={active ? "text-brand" : "opacity-0 transition group-hover:opacity-60 group-focus-visible:opacity-60"}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {shown.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      // Keys pressed on an inner link or button belong to that control.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={`border-b border-line2 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-raise" : ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${pad} ${align(c.align)} align-middle ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.hideBelowXl ? "hidden xl:table-cell" : ""} ${c.className ?? ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {paginate && sorted.length > 0 && (
      <Pagination
        total={sorted.length}
        page={current}
        pageSize={pageSize}
        mode={mode}
        noun={noun}
        onPage={setPage}
        onMode={(m) => {
          setMode(m);
          try {
            window.localStorage.setItem("pageSize", m);
          } catch {
            /* storage may be blocked */
          }
        }}
      />
    )}
    </>
  );
}
