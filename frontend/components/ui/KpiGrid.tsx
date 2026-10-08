"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

const MIN_CELL = 172; // narrowest a KPI cell can be before its figure and text are squeezed

/** The most columns that fit the width and still divide the cards evenly, so no row is left half empty. */
function columnsFor(width: number, count: number): number {
  const fit = Math.max(1, Math.floor(width / MIN_CELL));
  for (let c = Math.min(fit, count); c > 1; c--) if (count % c === 0) return c;
  return fit >= count ? count : 1;
}

/**
 * KPI cards as one band: thin dividers instead of separate boxes, and a column count picked from the width of
 * the band itself (not the screen) so six cards are 6, 3, 2 or 1 across and never five plus a stray one.
 */
export function KpiGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Children.toArray(children).filter(Boolean).length;
  const [cols, setCols] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCols(columnsFor(el.clientWidth, count));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  return (
    <div
      ref={ref}
      style={{ gridTemplateColumns: `repeat(${cols ?? Math.min(count, 2)}, minmax(0, 1fr))` }}
      className={`grid gap-px overflow-hidden rounded-card border border-line bg-line shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
