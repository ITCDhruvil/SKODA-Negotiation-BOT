"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s}T00:00:00`);
const shown = (s: string) => parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

function cells(year: number, month: number): (string | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const out: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) out.push(iso(new Date(year, month, d)));
  while (out.length % 7) out.push(null);
  return out;
}

/** One date with a calendar and quick choices; days before `min` cannot be picked. */
export function DatePicker({
  value,
  onChange,
  min,
  placeholder = "Pick a date",
  ariaLabel,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const start = value ? parse(value) : new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const root = useRef<HTMLDivElement>(null);
  const today = iso(new Date());

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const shift = (n: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const ahead = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  const quick = [
    { label: "In a week", v: ahead(7) },
    { label: "In two weeks", v: ahead(14) },
    { label: "In a month", v: ahead(30) },
  ];
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-[42px] w-full items-center justify-between gap-3 rounded-m border bg-panel px-3 py-2 text-left text-sm transition hover:border-brand focus:border-brand ${invalid ? "border-red" : "border-line"}`}
      >
        <span className={value ? "text-ink" : "text-muted"}>{value ? shown(value) : placeholder}</span>
        <Icon name="calendar" size={16} className="text-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a date" className="absolute left-0 z-40 mt-1 w-[19rem] max-w-[calc(100vw-2rem)] rounded-card border border-line bg-panel p-3 shadow-pop">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => pick(q.v)} className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-text hover:border-brand hover:text-brand">
                {q.label}
              </button>
            ))}
          </div>
          <div className="mb-1 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid h-8 w-8 place-items-center rounded-m hover:bg-raise">
              <Icon name="back" size={16} />
            </button>
            <span className="text-sm font-bold text-ink">{new Date(view.y, view.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid h-8 w-8 place-items-center rounded-m hover:bg-raise">
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted">
            {WEEK.map((w) => (
              <span key={w} className="py-1">{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells(view.y, view.m).map((day, i) => {
              if (!day) return <span key={i} />;
              const off = Boolean(min && day < min);
              const on = day === value;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={off}
                  onClick={() => pick(day)}
                  aria-pressed={on}
                  aria-label={shown(day)}
                  className={`h-9 rounded-m text-sm tabular-nums transition ${on ? "bg-brand font-bold text-on-brand" : off ? "cursor-not-allowed text-muted opacity-40" : "text-text hover:bg-raise"} ${day === today && !on ? "font-bold text-brand" : ""}`}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
