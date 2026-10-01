"use client";

import { useEffect, useRef, useState } from "react";
import { dateShort } from "@/lib/format";
import { Icon } from "./Icon";

export type Range = { from: string; to: string };

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s}T00:00:00`);

function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function presets(): { label: string; range: Range }[] {
  const today = new Date();
  const back = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return iso(d);
  };
  return [
    { label: "All dates", range: { from: "", to: "" } },
    { label: "Last 30 days", range: { from: back(30), to: iso(today) } },
    { label: "Last 90 days", range: { from: back(90), to: iso(today) } },
    { label: "This month", range: { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) } },
    { label: "This year", range: { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) } },
  ];
}

/** Date range with a calendar: pick a start day, then an end day; or use a preset. */
export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Range>(value);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const start = value.from ? parse(value.from) : new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = value.from || value.to ? `${value.from ? dateShort(value.from) : "…"} – ${value.to ? dateShort(value.to) : "…"}` : "All dates";
  const today = iso(new Date());

  const pick = (day: string) => {
    if (!draft.from || draft.to) setDraft({ from: day, to: "" });
    else if (day < draft.from) setDraft({ from: day, to: draft.from });
    else setDraft({ from: draft.from, to: day });
  };

  const lo = draft.from;
  const hi = draft.to || (draft.from && hoverDay && hoverDay >= draft.from ? hoverDay : "");
  const shift = (n: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const title = new Date(view.y, view.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={`Date range: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-m border border-line bg-panel px-3 text-sm font-medium text-ink hover:border-brand"
      >
        <Icon name="calendar" size={16} />
        <span className="hidden sm:inline">{label}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose dates" className="absolute right-0 z-40 mt-2 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-pop sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-line2 p-2 sm:grid sm:w-40 sm:content-start sm:border-b-0 sm:border-r sm:p-3">
            {presets().map((p) => {
              const on = p.range.from === draft.from && p.range.to === draft.to;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setDraft(p.range);
                    if (p.range.from) {
                      const d = parse(p.range.from);
                      setView({ y: d.getFullYear(), m: d.getMonth() });
                    }
                  }}
                  className={`shrink-0 whitespace-nowrap rounded-m px-3 py-2 text-left text-sm ${on ? "bg-brand-soft font-semibold text-ink" : "text-text hover:bg-raise"}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="w-[19rem] p-3">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid h-8 w-8 place-items-center rounded-m hover:bg-raise">
                <Icon name="back" size={16} />
              </button>
              <span className="text-sm font-bold text-ink">{title}</span>
              <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid h-8 w-8 place-items-center rounded-m hover:bg-raise">
                <Icon name="chevron" size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted">
              {WEEK.map((w) => (
                <span key={w} className="py-1">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7" onMouseLeave={() => setHoverDay(null)}>
              {monthCells(view.y, view.m).map((day, i) => {
                if (!day) return <span key={i} />;
                const isEdge = day === lo || day === hi;
                const inside = lo && hi && day > lo && day < hi;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(day)}
                    onMouseEnter={() => setHoverDay(day)}
                    aria-pressed={isEdge}
                    aria-label={dateShort(day)}
                    className={`h-9 text-sm tabular-nums transition ${
                      isEdge ? "rounded-m bg-brand font-bold text-on-brand" : inside ? "bg-brand-soft text-ink" : "rounded-m text-text hover:bg-raise"
                    } ${day === today && !isEdge ? "font-bold text-brand" : ""}`}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line2 pt-3">
              <span className="min-w-0 truncate text-xs text-muted">
                {draft.from ? `${dateShort(draft.from)} – ${draft.to ? dateShort(draft.to) : "pick an end date"}` : "Pick a start date"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-m px-3 py-1.5 text-xs font-semibold text-muted hover:bg-raise"
                  onClick={() => {
                    onChange({ from: "", to: "" });
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={Boolean(draft.from && !draft.to)}
                  className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
                  onClick={() => {
                    onChange(draft);
                    setOpen(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
