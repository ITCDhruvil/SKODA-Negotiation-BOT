import type { ReactNode } from "react";
import { initials, num } from "@/lib/format";

export const SERIES = [
  "var(--brand)",
  "var(--info)",
  "var(--amber)",
  "var(--red)",
  "var(--ok)",
  "var(--muted)",
];

export type Segment = { label: string; value: number; color: string };

export function Donut({
  segments,
  centerTop,
  centerBottom,
  label,
  total: fixedTotal,
}: {
  segments: Segment[];
  centerTop: string;
  centerBottom: string;
  label: string;
  /** Use when segment values are already shares of a known whole (e.g. 1); the rest stays as track. */
  total?: number;
}) {
  const total = fixedTotal ?? segments.reduce((s, x) => s + x.value, 0);
  const r = 48;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className="mx-auto h-40 w-40">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line2)" strokeWidth="16" />
      {total > 0 &&
        segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(len - 1, 0)} ${c - Math.max(len - 1, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="60" y="58" textAnchor="middle" className="fill-ink" style={{ fontSize: 13, fontWeight: 800 }}>
        {centerTop}
      </text>
      <text x="60" y="72" textAnchor="middle" className="fill-muted" style={{ fontSize: 8 }}>
        {centerBottom}
      </text>
    </svg>
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
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-on-brand"
      style={{ background: SERIES[index % SERIES.length] }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export type TrendPoint = { date: string; price: number; negotiated: boolean };
export type RefLine = { value: number; label: string; color: string };

/** Price over time. Filled dots are negotiated deals; reference lines mark today's anchors. */
export function TrendChart({ points, refLines = [], label }: { points: TrendPoint[]; refLines?: RefLine[]; label: string }) {
  const W = 640;
  const H = 240;
  const m = { l: 56, r: 16, t: 16, b: 32 };
  if (points.length === 0) return <p className="text-sm text-muted">No history to chart.</p>;
  const times = points.map((p) => new Date(`${p.date}T00:00:00`).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = [...points.map((p) => p.price), ...refLines.map((r) => r.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || hi * 0.05 || 1) * 0.12;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (t: number) => m.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const ordered = points.map((p, i) => ({ ...p, t: times[i] })).sort((a, b) => a.t - b.t);
  const path = ordered.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const ticks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line2)" />
          <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
            {num(Math.round(t * 100) / 100)}
          </text>
        </g>
      ))}
      {refLines.map((r, i) => (
        <g key={i}>
          <line x1={m.l} x2={W - m.r} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeDasharray="5 4" strokeWidth={1.5} />
          <text x={W - m.r} y={y(r.value) - 4} textAnchor="end" style={{ fontSize: 11, fill: r.color, fontWeight: 600 }}>
            {r.label}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth={1.5} />
      {ordered.map((p, i) => (
        <circle
          key={i}
          cx={x(p.t)}
          cy={y(p.price)}
          r={4.5}
          fill={p.negotiated ? "var(--brand)" : "var(--panel)"}
          stroke="var(--brand)"
          strokeWidth={2}
        >
          <title>{`${p.date}: ${num(p.price)}${p.negotiated ? " (negotiated)" : ""}`}</title>
        </circle>
      ))}
      <text x={m.l} y={H - 8} className="fill-muted" style={{ fontSize: 11 }}>
        {ordered[0].date}
      </text>
      <text x={W - m.r} y={H - 8} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
        {ordered[ordered.length - 1].date}
      </text>
    </svg>
  );
}
