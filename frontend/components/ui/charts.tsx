"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { initials, money, num } from "@/lib/format";

/** Categorical palette (tokens in globals.css, tuned for light and dark). */
export const SERIES = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];

export type Segment = { label: string; value: number; color: string };

export type DonutSegment = {
  label: string;
  /** Size of the slice; slices are drawn as a share of `total` (or of their sum). */
  value: number;
  color: string;
  /** Text shown in the legend, for example "₹ 1.2 L". */
  valueText: string;
  /** Percentage text shown in the legend and at the centre on hover, for example "34%". */
  percentText: string;
};

/**
 * Ring chart with an interactive legend: hovering or focusing a slice or a legend row lifts that slice,
 * dims the rest and shows its share at the centre. The layout keeps the ring on top and the legend below,
 * so it fits a narrow column.
 */
export function DonutChart({
  segments,
  centerTop,
  centerBottom,
  label,
  total: fixedTotal,
  stats,
}: {
  segments: DonutSegment[];
  centerTop: string;
  centerBottom: string;
  label: string;
  total?: number;
  stats?: { label: string; value: string }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = fixedTotal ?? segments.reduce((s, x) => s + x.value, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 3 : 0;
  let offset = 0;
  const current = active != null ? segments[active] : null;

  return (
    <div>
      {stats && (
        <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <dd className="text-base font-extrabold text-ink tabular-nums">{s.value}</dd>
              <dt className="text-[11px] leading-tight text-muted">{s.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <svg viewBox="0 0 200 200" role="img" aria-label={label} className="mx-auto block h-52 w-52">
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--line2)" strokeWidth={26} />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * c;
            const draw = Math.max(len - gap, 0);
            const el = (
              <circle
                key={i}
                cx="100"
                cy="100"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? 32 : 26}
                strokeLinecap="butt"
                strokeDasharray={`${draw} ${c - draw}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
                opacity={active == null || active === i ? 1 : 0.35}
                style={{ transition: "stroke-width 160ms ease, opacity 160ms ease", cursor: "pointer" }}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return el;
          })}
        <text x="100" y={current ? 96 : 98} textAnchor="middle" className="fill-ink" style={{ fontSize: current ? 26 : 22, fontWeight: 800 }}>
          {current ? current.percentText : centerTop}
        </text>
        <text x="100" y="118" textAnchor="middle" className="fill-muted" style={{ fontSize: 11 }}>
          {current ? (current.label.length > 24 ? `${current.label.slice(0, 23)}…` : current.label) : centerBottom}
        </text>
      </svg>
      <ul className="mt-3 grid gap-0.5 text-sm" onMouseLeave={() => setActive(null)}>
        {segments.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={`flex w-full items-center gap-2.5 rounded-s px-2 py-1.5 text-left transition ${active === i ? "bg-raise" : ""}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-text">{s.label}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{s.valueText}</span>
              <span className="w-11 shrink-0 text-right font-semibold text-ink tabular-nums">{s.percentText}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StackBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div role="img" aria-label={label} className="flex h-3 overflow-hidden rounded-full bg-raise">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
            ))}
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 text-text">{s.label}</span>
            <span className="font-semibold text-ink tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
      style={{ background: SERIES[index % SERIES.length] }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export type TrendPoint = { date: string; price: number; negotiated: boolean; label?: string };
export type RefLine = { value: number; label: string; color: string };

const DAY = 86_400_000;
const RANGES = [
  { key: "3m", label: "3M", days: 92 },
  { key: "6m", label: "6M", days: 183 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: Infinity },
] as const;

/** Smooth monotone curve through the points (no overshoot between them). */
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      t[i] = (3 * a * m[i]) / h;
      t[i + 1] = (3 * b * m[i]) / h;
    }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    d += ` C${c1x.toFixed(1)},${(pts[i].y + (t[i] * dx[i]) / 3).toFixed(1)} ${c2x.toFixed(1)},${(pts[i + 1].y - (t[i + 1] * dx[i]) / 3).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Interactive price chart: smooth line with a soft fill, a crosshair and a tooltip that follow the pointer
 * (or the arrow keys), range buttons, the latest price on the right axis, and dashed reference lines.
 */
export function TrendChart({ points, refLines = [], label }: { points: TrendPoint[]; refLines?: RefLine[]; label: string }) {
  const uid = useId().replace(/:/g, "");
  const box = useRef<SVGSVGElement>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const [hover, setHover] = useState<number | null>(null);

  // Draw at the real pixel width so text and strokes keep their size however wide the card is.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(320, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const H = 240;
  const m = { l: 8, r: 52, t: 16, b: 26 };

  const all = useMemo(
    () => points.map((p) => ({ ...p, t: new Date(`${p.date}T00:00:00`).getTime() })).sort((a, b) => a.t - b.t),
    [points],
  );
  const view = useMemo(() => {
    if (all.length === 0) return all;
    const days = RANGES.find((r) => r.key === range)!.days;
    const cutoff = all[all.length - 1].t - days * DAY;
    const sliced = all.filter((p) => p.t >= cutoff);
    return sliced.length >= 2 ? sliced : all;
  }, [all, range]);

  if (all.length === 0) return <p className="text-sm text-muted">No history to chart.</p>;

  const t0 = view[0].t;
  const t1 = view[view.length - 1].t;
  const values = [...view.map((p) => p.price), ...refLines.map((r) => r.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || hi * 0.05 || 1) * 0.14;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (t: number) => m.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const xy = view.map((p) => ({ x: x(p.t), y: y(p.price) }));
  const line = smoothPath(xy);
  const baseY = H - m.b;
  const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${baseY} L${xy[0].x.toFixed(1)},${baseY} Z`;
  const ticks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);
  const last = view[view.length - 1];
  const hiPt = view.reduce((a, b) => (b.price > a.price ? b : a));
  const loPt = view.reduce((a, b) => (b.price < a.price ? b : a));
  const shown = hover != null ? view[hover] : last;

  const nearest = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].x - vx) < Math.abs(xy[best].x - vx)) best = i;
    return best;
  };

  const tipLeft = hover != null ? Math.min(Math.max((xy[hover].x / W) * 100, 12), 88) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{hover != null ? longDate(shown.date) : `Latest · ${longDate(last.date)}`}</div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold tracking-tight text-ink tabular-nums">{money(shown.price)}</span>
            {shown.negotiated ? <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">Negotiated</span> : null}
          </div>
        </div>
        <div className="inline-flex rounded-m border border-line bg-raise p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              className={`min-w-[2.5rem] rounded-s px-3 py-1.5 text-xs font-bold transition ${range === r.key ? "bg-panel text-brand shadow-card" : "text-muted hover:text-ink"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrap} className="relative">
        <svg
          ref={box}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="block touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          onPointerMove={(e) => setHover(nearest(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? view.length) - 1));
            else if (e.key === "ArrowRight") setHover((h) => Math.min(view.length - 1, (h ?? -1) + 1));
            else if (e.key === "Escape") setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c2)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--c2)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((tk, i) => (
            <g key={i}>
              <line x1={m.l} x2={W - m.r} y1={y(tk)} y2={y(tk)} stroke="var(--line2)" />
              <text x={W - m.r + 8} y={y(tk) + 4} className="fill-muted" style={{ fontSize: 11 }}>
                {num(Math.round(tk))}
              </text>
            </g>
          ))}

          {refLines.map((r, i) => (
            <g key={i}>
              <line x1={m.l} x2={W - m.r} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeDasharray="5 4" strokeWidth={1.4} opacity={0.9} />
              <text x={m.l + 4} y={y(r.value) - 5} style={{ fontSize: 11, fill: r.color, fontWeight: 700 }}>
                {r.label} {num(r.value)}
              </text>
            </g>
          ))}

          <path d={area} fill={`url(#${uid}-fill)`} />
          <path d={line} fill="none" stroke="var(--c2)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />

          {view.length <= 60 &&
            view.map((p, i) => (
              <circle key={i} cx={xy[i].x} cy={xy[i].y} r={p.negotiated ? 3.6 : 2.6} fill={p.negotiated ? "var(--c1)" : "var(--panel)"} stroke={p.negotiated ? "var(--c1)" : "var(--c2)"} strokeWidth={1.6} />
            ))}

          {[hiPt, loPt].map((p, i) => {
            const idx = view.indexOf(p);
            if (idx < 0 || (i === 1 && hiPt === loPt)) return null;
            return (
              <text key={i} x={xy[idx].x} y={xy[idx].y + (i === 0 ? -9 : 17)} textAnchor="middle" className="fill-ink" style={{ fontSize: 11, fontWeight: 700 }}>
                {num(p.price)}
              </text>
            );
          })}


          {hover != null && (
            <g pointerEvents="none">
              <line x1={xy[hover].x} x2={xy[hover].x} y1={m.t} y2={baseY} stroke="var(--muted)" strokeDasharray="4 4" />
              <circle cx={xy[hover].x} cy={xy[hover].y} r={9} fill="var(--c2)" opacity={0.18} />
              <circle cx={xy[hover].x} cy={xy[hover].y} r={5} fill="var(--panel)" stroke="var(--c2)" strokeWidth={2.5} />
            </g>
          )}

          <text x={m.l} y={H - 8} className="fill-muted" style={{ fontSize: 11 }}>
            {shortDate(view[0].date)}
          </text>
          <text x={W - m.r} y={H - 8} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
            {shortDate(last.date)}
          </text>
        </svg>

        {hover != null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-m border border-line bg-panel px-3 py-2 text-xs shadow-card"
            style={{ left: `${tipLeft}%` }}
          >
            <div className="font-bold text-ink tabular-nums">{money(view[hover].price)}</div>
            <div className="text-muted">{shortDate(view[hover].date)}{view[hover].label ? ` · ${view[hover].label}` : ""}</div>
            <div className={view[hover].negotiated ? "font-semibold text-ok" : "text-muted"}>{view[hover].negotiated ? "Negotiated deal" : "List-price deal"}</div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Hover or use the arrow keys to read a deal. Green dots were negotiated; hollow dots were not.</p>
    </div>
  );
}

export function Legend({ rows }: { rows: { color: string; label: ReactNode; right: ReactNode }[] }) {
  return (
    <ul className="grid gap-2 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="min-w-0 flex-1 truncate text-text">{r.label}</span>
          <span className="shrink-0 text-muted tabular-nums">{r.right}</span>
        </li>
      ))}
    </ul>
  );
}
