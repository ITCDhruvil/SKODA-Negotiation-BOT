"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type FilterDef = {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

/** Search box that lives in the table header. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 focus-within:border-brand hover:border-brand sm:max-w-md">
      <Icon name="search" size={16} className="text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-raise">
          <Icon name="close" size={12} />
        </button>
      )}
    </label>
  );
}

/**
 * A filter button next to the search box (not inside it). It opens a menu of filters, each showing its
 * current choice; picking one opens its options.
 */
export function FilterMenu({ filters }: { filters: FilterDef[] }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [rowTop, setRowTop] = useState(0);
  const [optQ, setOptQ] = useState("");
  const [wide, setWide] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const active = filters.filter((f) => f.value !== "").length;

  // Wide screens show a side panel on hover; narrow ones replace the list instead.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view) setView(null);
        else setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, view]);

  const current = filters.find((f) => f.key === view);
  // A new filter starts with an empty search.
  useEffect(() => setOptQ(""), [view]);
  const labelOf = (f: FilterDef) => f.options.find((o) => o.value === f.value)?.label ?? f.options[0]?.label ?? "";
  const showList = wide || !current;

  const options = current && (
    <div>
      <label className="mx-2.5 mb-1 mt-1 flex items-center gap-2 rounded-m border border-line bg-panel px-2.5 py-1.5 focus-within:border-brand">
        <Icon name="search" size={14} className="text-muted" />
        <input
          value={optQ}
          onChange={(e) => setOptQ(e.target.value)}
          placeholder={`Search ${current.label.toLowerCase()}`}
          aria-label={`Search ${current.label.toLowerCase()}`}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </label>
      <div role="group" aria-label={current.label} className="max-h-64 overflow-auto py-1">
      {current.options.filter((o) => !optQ.trim() || o.label.toLowerCase().includes(optQ.trim().toLowerCase())).map((o) => (
        <button
          key={o.value}
          role="menuitemradio"
          aria-checked={current.value === o.value}
          type="button"
          onClick={() => {
            current.onChange(o.value);
            setView(null);
            if (wide) setOpen(false);
          }}
          className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm text-text hover:bg-raise"
        >
          <span className={current.value === o.value ? "font-semibold text-ink" : ""}>{o.label}</span>
          {current.value === o.value && <Icon name="check" size={16} className="text-brand" />}
        </button>
      ))}
      {current.options.every((o) => optQ.trim() && !o.label.toLowerCase().includes(optQ.trim().toLowerCase())) && (
        <p className="px-3.5 py-3 text-sm text-muted">No match.</p>
      )}
      </div>
    </div>
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Filters"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filters"
        onClick={() => {
          setOpen((o) => !o);
          setView(null);
        }}
        className={`relative grid h-10 w-10 place-items-center rounded-m border bg-panel text-ink hover:border-brand ${active ? "border-brand" : "border-line"}`}
      >
        <Icon name="sliders" size={18} />
        {active > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">{active}</span>}
      </button>
      {open && (
        <div role="menu" onMouseLeave={() => wide && setView(null)} className="absolute left-0 z-40 mt-2 w-64 rounded-card border border-line bg-panel py-1.5 shadow-pop">
          {showList &&
            filters.map((f) => (
              <button
                key={f.key}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={view === f.key}
                type="button"
                onMouseEnter={(e) => {
                  if (!wide) return;
                  setRowTop(e.currentTarget.offsetTop - 6);
                  setView(f.key);
                }}
                onFocus={(e) => {
                  if (!wide) return;
                  setRowTop(e.currentTarget.offsetTop - 6);
                  setView(f.key);
                }}
                onClick={(e) => {
                  setRowTop(e.currentTarget.offsetTop - 6);
                  setView(f.key);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-raise ${view === f.key ? "bg-raise" : ""}`}
              >
                <span className="font-semibold text-ink">{f.label}</span>
                <span className="flex min-w-0 items-center gap-1 text-muted">
                  <span className="truncate">{labelOf(f)}</span>
                  <Icon name="chevron" size={14} />
                </span>
              </button>
            ))}
          {showList && active > 0 && (
            <button
              type="button"
              onMouseEnter={() => setView(null)}
              onClick={() => filters.forEach((f) => f.onChange(""))}
              className="mt-1 w-full border-t border-line2 px-3.5 py-2.5 text-left text-sm font-semibold text-brand hover:bg-raise"
            >
              Clear all filters
            </button>
          )}
          {current && !wide && (
            <>
              <button type="button" onClick={() => setView(null)} className="flex w-full items-center gap-2 border-b border-line2 px-3.5 py-2.5 text-left text-sm font-semibold text-ink hover:bg-raise">
                <Icon name="back" size={14} />
                {current.label}
              </button>
              {options}
            </>
          )}
          {current && wide && (
            <div className="absolute left-full w-64 pl-1" style={{ top: Math.max(rowTop, 0) }}>
              <div role="menu" aria-label={current.label} className="rounded-card border border-line bg-panel py-1.5 shadow-pop">
                {options}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Search, the detached filter button and a count, in one row above a table. */
export function TableToolbar({
  search,
  filters,
  right,
}: {
  search: { value: string; onChange: (v: string) => void; placeholder: string };
  filters?: FilterDef[];
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <SearchBox {...search} />
      {filters && filters.length > 0 && <FilterMenu filters={filters} />}
      {right && <div className="ml-auto flex items-center gap-2 text-xs text-muted">{right}</div>}
    </div>
  );
}

const ICON_BTN =
  "grid h-9 w-9 place-items-center rounded-m border border-line bg-panel text-ink transition hover:border-brand hover:text-brand";

/** Icon-only link for table actions; the label is the tooltip and the accessible name. */
export function IconLink({ href, icon, label, external }: { href: string; icon: IconName; label: string; external?: boolean }) {
  return (
    <Link href={href} aria-label={label} title={label} onClick={(e) => e.stopPropagation()} className={ICON_BTN} {...(external ? { target: "_blank" } : {})}>
      <Icon name={icon} size={17} />
    </Link>
  );
}

export function IconAction({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}
