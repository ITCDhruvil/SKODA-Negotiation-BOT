"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Select } from "./Select";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Page numbers to show: always the first, the last and the neighbours of the current page, with gaps as null. */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => keep.add(n));
  const sorted = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

const NAV_BTN =
  "grid h-9 min-w-9 place-items-center rounded-m border border-transparent px-2 text-sm font-semibold text-text transition hover:border-line hover:bg-raise disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent";

/**
 * Table footer: the range on show, rows per page, first / previous / numbered / next / last buttons and a
 * jump-to-page box once there are many pages. Everything is keyboard reachable; the current page is marked
 * with aria-current.
 */
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  noun = "rows",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const [jump, setJump] = useState("");
  useEffect(() => setJump(""), [page, pageSize]);
  const go = (p: number) => onPage(Math.min(Math.max(1, p), pages));

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted">
        <span aria-live="polite">
          Showing <b className="font-semibold text-ink tabular-nums">{from}–{to}</b> of <b className="font-semibold text-ink tabular-nums">{total}</b> {noun}
        </span>
        <span className="flex items-center gap-2">
          Rows per page
          <span className="w-24">
            <Select
              placement="top"
              ariaLabel="Rows per page"
              value={String(pageSize)}
              onChange={(v) => onPageSize(Number(v))}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-label="First page" title="First page" className={NAV_BTN} disabled={page <= 1} onClick={() => go(1)}>
          <span className="flex -space-x-2">
            <Icon name="back" size={15} />
            <Icon name="back" size={15} />
          </span>
        </button>
        <button type="button" aria-label="Previous page" title="Previous page" className={NAV_BTN} disabled={page <= 1} onClick={() => go(page - 1)}>
          <Icon name="back" size={16} />
        </button>
        {pageList(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} aria-hidden="true" className="grid h-9 w-6 place-items-center text-muted">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              onClick={() => go(n)}
              className={`${NAV_BTN} tabular-nums ${n === page ? "!border-brand bg-brand-soft text-brand" : ""}`}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" aria-label="Next page" title="Next page" className={NAV_BTN} disabled={page >= pages} onClick={() => go(page + 1)}>
          <Icon name="chevron" size={16} />
        </button>
        <button type="button" aria-label="Last page" title="Last page" className={NAV_BTN} disabled={page >= pages} onClick={() => go(pages)}>
          <span className="flex -space-x-2">
            <Icon name="chevron" size={15} />
            <Icon name="chevron" size={15} />
          </span>
        </button>
        {pages > 7 && (
          <form
            className="ml-2 flex items-center gap-2 text-muted"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (Number.isFinite(n) && n >= 1) go(Math.round(n));
            }}
          >
            <label htmlFor="page-jump">Go to</label>
            <input
              id="page-jump"
              inputMode="numeric"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              placeholder={String(page)}
              className="h-9 w-14 rounded-m border border-line bg-panel px-2 text-center text-sm text-ink tabular-nums focus:border-brand"
            />
          </form>
        )}
      </div>
    </nav>
  );
}
