"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Dashboard, EventView } from "@/lib/api";
import { moneyCompact, pct } from "@/lib/format";

type K = Dashboard["kpis"];

const TONE = {
  info: "bg-info-soft text-info",
  ok: "bg-ok-soft text-ok",
  amber: "bg-amber-soft text-amber",
  brand: "bg-brand-soft text-brand",
} as const;

/** What an event is worth now: the final value once closed, the quoted value before that. */
const worth = (e: EventView) => (e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value) || 0;

/** Total value week by week from the events' creation dates, and how much the total grew in the last 30 days. */
function trendOf(events: EventView[]) {
  const dated = events
    .map((e) => ({ t: new Date(e.created).getTime(), v: worth(e) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (dated.length < 2) return { points: [] as number[], change: null as number | null };
  const day = 86400000;
  const end = dated[dated.length - 1].t;
  const weeks = Math.min(26, Math.max(2, Math.ceil((end - dated[0].t) / (7 * day)) + 1));
  const start = end - (weeks - 1) * 7 * day;
  const buckets = new Array(weeks).fill(0);
  let before = 0;
  for (const x of dated) {
    if (x.t < start) before += x.v;
    else buckets[Math.min(weeks - 1, Math.floor((x.t - start) / (7 * day)))] += x.v;
  }
  let run = before;
  const points = buckets.map((b) => (run += b));
  const total = run;
  const recent = dated.filter((x) => x.t > end - 30 * day).reduce((s, x) => s + x.v, 0);
  const then = total - recent;
  return { points, change: then > 0 ? recent / then : null };
}

function Sparkline({ points }: { points: number[] }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) return null;
  const W = 300;
  const H = 96;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 8 - ((p - min) / span) * (H - 24)] as const);
  // Smooth curve: each step leaves and arrives flat, so it never overshoots the data.
  const line = xy
    .map(([x, y], i) => {
      if (i === 0) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = xy[i - 1];
      const mx = ((px + x) / 2).toFixed(1);
      return `C${mx} ${py.toFixed(1)} ${mx} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const tone = "color-mix(in srgb, var(--info) 70%, var(--panel))";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full min-h-[84px] w-full" role="img" aria-label="Total value over time, week by week">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.32" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={tone} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Head({ icon, tone, title, sub }: { icon: IconName; tone: keyof typeof TONE; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${TONE[tone]}`}>
        <Icon name={icon} size={21} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold leading-tight text-ink">{title}</div>
        <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>
      </div>
      <Icon name="chevron" size={16} className="mt-1 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
    </div>
  );
}

function Card({ href, label, className = "", children }: { href: string; label: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`group flex min-w-0 flex-col gap-3 rounded-card border border-line bg-panel p-4 shadow-card transition hover:border-brand focus-visible:border-brand focus-visible:outline-none ${className}`}
    >
      {children}
    </Link>
  );
}

function Split({ items }: { items: { color: string; label: string; value: string; note?: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-line2">
      {items.map((s, i) => (
        <div key={s.label} className={`min-w-0 ${i ? "pl-5" : "pr-5"}`}>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="truncate">{s.label}</span>
          </div>
          <div className="mt-1.5 truncate text-[22px] font-extrabold leading-none tabular-nums text-ink">{s.value}</div>
          {s.note && <div className="mt-1.5 truncate text-xs text-muted">{s.note}</div>}
        </div>
      ))}
    </div>
  );
}

function Pill({ tone, children, dot }: { tone: "amber" | "ok" | "info"; children: ReactNode; dot?: boolean }) {
  const t = { amber: "bg-amber-soft text-amber", ok: "bg-ok-soft text-ok", info: "bg-info-soft text-info" }[tone];
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${t}`}>
      {dot && <span className="h-2 w-2 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * The dashboard's headline figures as a bento: two tall cards (value with its trend, savings split) and four
 * small ones. The layout follows the width of the area it sits in: 4 columns, then 2, then 1.
 */
export function DashboardKpis({ k, events, opportunities = [] }: { k: K; events: EventView[]; opportunities?: Dashboard["opportunities"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { points, change } = useMemo(() => trendOf(events), [events]);
  const potential = k.potential_total || 0;
  const sShare = potential > 0 ? k.potential_savings / potential : 0;
  const uShare = potential > 0 ? k.potential_uplift / potential : 0;

  const top = useMemo(() => [...opportunities].sort((a, b) => b.potential_delta - a.potential_delta).slice(0, 3), [opportunities]);
  const realisedShare = potential > 0 ? (k.realised_total || 0) / potential : 0;
  const openValue = useMemo(() => events.filter((e) => e.status !== "closed").reduce((t, e) => t + worth(e), 0), [events]);
  const closedValue = useMemo(() => events.filter((e) => e.status === "closed").reduce((t, e) => t + worth(e), 0), [events]);
  const closedCount = events.filter((e) => e.status === "closed").length;
  const wide = w >= 880;
  const cols = wide ? "1.25fr 1.25fr 1fr 1fr" : w >= 560 ? "1fr 1fr" : "1fr";
  const tall = wide ? "row-span-2" : "";
  const closed = k.total_events - k.open_events;

  return (
    <div ref={ref} style={{ gridTemplateColumns: cols }} className="grid gap-3">
      <Card href="/reports" label="Procurement value, open the reports" className={tall}>
        <Head icon="coin" tone="info" title="Procurement Value" sub="Total value of quoted or final" />
        <div className="flex flex-1 flex-col justify-between gap-5 pt-4">
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums text-ink">{moneyCompact(k.total_value)}</div>
              {change != null && (
                <div className="shrink-0 pt-0.5 text-right leading-tight">
                  <div className={`inline-flex items-center gap-1 text-sm font-bold ${change >= 0 ? "text-ok" : "text-red"}`}>
                    <Icon name="trend" size={14} className={change < 0 ? "rotate-90" : ""} />
                    {change >= 0 ? "+" : ""}
                    {pct(change, 0)}
                  </div>
                  <div className="text-[11px] text-muted">vs 30 days ago</div>
                </div>
              )}
            </div>
            <Pill tone="info">Quoted or final</Pill>
          </div>
          <Split
            items={[
              { color: "var(--c2)", label: "Open (quoted)", value: moneyCompact(openValue), note: `${k.open_events} events` },
              { color: "var(--c1)", label: "Closed (final)", value: moneyCompact(closedValue), note: `${closedCount} events` },
            ]}
          />
          <div className="min-h-[84px] flex-1">
            <Sparkline points={points} />
          </div>
        </div>
      </Card>

      <Card href="/comparison" label="Savings opportunity, open the comparison" className={tall}>
        <Head icon="trend" tone="ok" title="Savings Opportunity" sub="Potential savings and uplift" />
        <div className="grid gap-5 pt-5">
          <div className="flex items-end justify-between gap-3">
            <div className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums text-ink">{moneyCompact(potential)}</div>
            <div className="shrink-0 pb-1 text-xs text-muted">of {moneyCompact(potential)}</div>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-raise"
            role="img"
            aria-label={`Savings ${pct(sShare, 0)} and uplift ${pct(uShare, 0)} of the potential`}
          >
            <span className="h-full" style={{ width: `${sShare * 100}%`, background: "var(--c1)" }} />
            <span className="h-full" style={{ width: `${uShare * 100}%`, background: "color-mix(in srgb, var(--c2) 38%, var(--panel))" }} />
          </div>
          <Split
            items={[
              { color: "var(--c1)", label: "Savings", value: moneyCompact(k.potential_savings), note: `${pct(sShare, 0)} of potential` },
              { color: "var(--c2)", label: "Uplift", value: moneyCompact(k.potential_uplift), note: `${pct(uShare, 0)} of potential` },
            ]}
          />
        </div>
        {top.length > 0 && (
          <div className="mt-auto grid gap-2 border-t border-line2 pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-muted">Biggest opportunities</span>
              <span className="text-[11px] text-muted">{pct(potential > 0 ? realisedShare : 0, 1)} realised so far</span>
            </div>
            <ul className="grid gap-1.5">
              {top.map((o) => (
                <li key={o.item_id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-text" title={o.description}>
                    {o.description}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-ok">{moneyCompact(Math.round(o.potential_delta))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card href="/negotiations" label="Active negotiations">
        <Head icon="chat" tone="amber" title="Active Negotiations" sub="Talks and approvals" />
        <div className="mt-auto grid gap-1.5 pt-3">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="text-[36px] font-extrabold leading-none tabular-nums text-ink">{k.negotiations_in_progress}</div>
            <Pill tone="amber" dot>
              In progress
            </Pill>
          </div>
          <div className="text-xs text-muted">{pct(k.total_events > 0 ? k.negotiations_in_progress / k.total_events : 0, 0)} of all events</div>
        </div>
      </Card>

      <Card href="/events" label="Events">
        <Head icon="events" tone="info" title="Events" sub="Total events" />
        <div className="mt-auto grid gap-2 pt-1">
          <div className="text-[32px] font-extrabold leading-none tabular-nums text-ink">{k.total_events}</div>
          <Split
            items={[
              { color: "var(--c1)", label: "Open", value: String(k.open_events) },
              { color: "var(--muted)", label: "Closed", value: String(closed) },
            ]}
          />
        </div>
      </Card>

      <Card href="/comparison" label="Items and suppliers">
        <Head icon="cube" tone="brand" title="Items & Suppliers" sub="Total items / lots and vendors" />
        <div className="mt-auto pt-1">
          <div className="grid grid-cols-2 divide-x divide-line2">
            <div className="min-w-0 pr-4">
              <div className="text-[28px] font-extrabold leading-none tabular-nums text-ink">{k.items}</div>
              <div className="mt-1.5 truncate text-xs text-muted">Items &amp; lots</div>
            </div>
            <div className="min-w-0 pl-4">
              <div className="text-[28px] font-extrabold leading-none tabular-nums text-ink">{k.vendors}</div>
              <div className="mt-1.5 truncate text-xs text-muted">Vendors</div>
            </div>
          </div>
        </div>
      </Card>

      <Card href="/history" label="Completed negotiations">
        <Head icon="check" tone="ok" title="Completed" sub="Negotiations finished" />
        <div className="mt-auto grid gap-1.5 pt-3">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="text-[36px] font-extrabold leading-none tabular-nums text-ink">{k.completed_negotiations}</div>
            <Pill tone="ok">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-ok text-on-brand text-[10px] font-bold" aria-hidden>
                ₹
              </span>
              {moneyCompact(k.realised_total)} generated
            </Pill>
          </div>
          <div className="text-xs text-muted">{pct(k.total_events > 0 ? k.completed_negotiations / k.total_events : 0, 0)} of all events</div>
        </div>
      </Card>
    </div>
  );
}
