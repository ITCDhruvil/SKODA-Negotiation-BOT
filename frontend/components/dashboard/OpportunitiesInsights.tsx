"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Dashboard } from "@/lib/api";
import { moneyCompact, num, pct } from "@/lib/format";
import { deltaLabel } from "@/lib/labels";

type D = Dashboard;

const TILE = [
  "bg-ok-soft text-ok",
  "bg-info-soft text-info",
  "bg-brand-soft text-brand",
  "bg-amber-soft text-amber",
  "bg-red-soft text-red",
] as const;

const TONE = {
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  amber: "bg-amber-soft text-amber",
  brand: "bg-brand-soft text-brand",
} as const;

type Insight = { tone: keyof typeof TONE; icon: IconName; text: ReactNode; href?: string; cta?: string };

/** Observations worked out from what the dashboard already loaded, most useful first. */
function buildInsights(data: D): Insight[] {
  const out: Insight[] = [];
  const k = data.kpis;
  const best = [...data.opportunities].sort((a, b) => b.potential_delta - a.potential_delta)[0];
  if (best) {
    out.push({
      tone: "ok",
      icon: "trend",
      text: (
        <>
          <b className="text-ink">{best.description}</b> has the most to win: {moneyCompact(Math.round(best.potential_delta))} of{" "}
          {deltaLabel(best.direction).toLowerCase()} if it closes at target.
        </>
      ),
      href: `/items/${best.item_id}`,
      cta: "Negotiate",
    });
  }
  if (data.insight) {
    out.push({
      tone: "info",
      icon: "comparison",
      text: (
        <>
          <b className="text-ink">{data.insight.description}</b> has the widest gap between vendor bids ({pct(data.insight.spread)}).
        </>
      ),
      href: `/items/${data.insight.item_id}`,
      cta: "Compare bids",
    });
  }
  const waiting = data.status_distribution.received ?? 0;
  if (waiting > 0) {
    out.push({
      tone: "amber",
      icon: "events",
      text: (
        <>
          <b className="text-ink">{waiting}</b> {waiting === 1 ? "event is" : "events are"} received and not started yet.
        </>
      ),
      href: "/events",
      cta: "View events",
    });
  }
  const v = data.top_vendors[0];
  if (v && v.share > 0) {
    out.push({
      tone: "brand",
      icon: "vendors",
      text: (
        <>
          <b className="text-ink">{v.vendor_name}</b> holds {pct(v.share, 0)} of the quoted value. Keep another quote warm.
        </>
      ),
      href: `/vendors/${v.vendor_id}`,
      cta: "View vendor",
    });
  }
  const c = data.value_by_category[0];
  if (c && c.share > 0) {
    out.push({
      tone: "info",
      icon: "cube",
      text: (
        <>
          <b className="text-ink">{c.category.replace(/^\d+ - /, "")}</b> is the largest category at {pct(c.share, 0)} of the total value.
        </>
      ),
      href: "/reports",
      cta: "Open reports",
    });
  }
  if (k.potential_total > 0 && k.realised_total > 0) {
    out.push({
      tone: "ok",
      icon: "check",
      text: (
        <>
          <b className="text-ink">{moneyCompact(Math.round(k.realised_total))}</b> generated so far, {pct(k.realised_total / k.potential_total, 1)} of the{" "}
          {moneyCompact(k.potential_total)} potential.
        </>
      ),
      href: "/history",
      cta: "See results",
    });
  }
  return out.slice(0, 5);
}

function Head({ icon, tone, title, sub, badge }: { icon: IconName; tone: string; title: string; sub: string; badge?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${tone}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold leading-tight text-ink">{title}</h2>
        <p className="text-[13px] text-muted">{sub}</p>
      </div>
      {badge}
    </div>
  );
}

export function OpportunitiesInsights({ data }: { data: D }) {
  const list = data.opportunities.slice(0, 5);
  const insights = useMemo(() => buildInsights(data), [data]);
  // Side by side whenever there is room for both (judged by the width of this area, not the screen), stacked below that.
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1100);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const twoCols = w >= 700;
  const roomy = w >= 1000; // wide enough to show the quantity column in each row

  return (
    <div ref={ref} style={{ gridTemplateColumns: twoCols ? "minmax(0, 1.7fr) minmax(0, 1fr)" : "minmax(0, 1fr)" }} className="grid items-stretch gap-4">
      <section className="flex flex-col rounded-card border border-line bg-panel p-4 shadow-card" aria-label="Negotiation opportunities">
        <Head
          icon="chat"
          tone="bg-ok-soft text-ok"
          title="Negotiation opportunities"
          sub="Items with potential for better pricing or terms."
          badge={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
              <Icon name="trend" size={13} />
              {data.opportunities.length} {data.opportunities.length === 1 ? "opportunity" : "opportunities"}
            </span>
          }
        />
        {list.length === 0 ? (
          <p className="mt-4 text-sm text-muted">None yet. Analyze quotes on an event to see them here.</p>
        ) : (
          <ul className="mt-4 grid flex-1 auto-rows-fr gap-2">
            {list.map((o, i) => (
              <li key={o.item_id}>
                <Link
                  href={`/items/${o.item_id}`}
                  style={{ gridTemplateColumns: roomy ? "minmax(0,1fr) 130px 170px 20px" : "minmax(0,1fr) auto" }}
                  className="group grid h-full items-center gap-x-4 gap-y-2 rounded-card border border-line2 px-3.5 py-3 transition hover:bg-raise focus-visible:bg-raise focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${TILE[i % TILE.length]}`}>
                      <Icon name="cube" size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{o.description}</span>
                      <span className="block truncate text-xs text-muted">{o.title}</span>
                    </span>
                  </span>
                  <span className={`${roomy ? "flex" : "hidden"} items-center gap-2`}>
                    <Icon name="bag" size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold tabular-nums text-ink">
                        {num(o.qty)} {o.unit.toLowerCase()}
                      </span>
                      <span className="block text-xs text-muted">Quantity</span>
                    </span>
                  </span>
                  <span className={`grid gap-1 ${roomy ? "justify-items-start" : "justify-items-end"}`}>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${o.direction === "buy" ? "bg-info-soft text-info" : "bg-amber-soft text-amber"}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                      {o.direction === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-ok">
                      <span aria-hidden className="text-[9px]">▲</span>
                      {moneyCompact(Math.round(o.potential_delta))} {deltaLabel(o.direction)}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className={`${roomy ? "block" : "hidden"} text-muted transition group-hover:translate-x-0.5 group-hover:text-brand`} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data.opportunities.length > list.length && (
          <div className="mt-3 text-right">
            <Link href="/comparison" className="text-sm font-semibold text-brand hover:underline">
              View all {data.opportunities.length} opportunities
            </Link>
          </div>
        )}
      </section>

      <section className="flex flex-col rounded-card border border-line bg-panel p-4 shadow-card" aria-label="Insights">
        <Head
          icon="bulb"
          tone="bg-amber-soft text-amber"
          title="Insights"
          sub="What stands out in your data."
          badge={insights.length > 0 ? <span className="rounded-full bg-raise px-2.5 py-1 text-xs font-bold tabular-nums text-text">{insights.length}</span> : undefined}
        />
        {insights.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Insights appear once there are quotes to compare.</p>
        ) : (
          <ul className="mt-4 grid flex-1 auto-rows-fr gap-2.5">
            {insights.map((n, i) => (
              <li key={i} className="flex items-center gap-3 rounded-card bg-raise p-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${TONE[n.tone]}`}>
                  <Icon name={n.icon} size={17} />
                </span>
                <div className="min-w-0 text-sm leading-snug text-text">
                  <p>{n.text}</p>
                  {n.href && (
                    <Link href={n.href} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                      {n.cta}
                      <Icon name="chevron" size={12} />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
