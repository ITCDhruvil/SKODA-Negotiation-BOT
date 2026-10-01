"use client";

import Link from "next/link";
import { EventsPanel } from "@/components/events/EventsPanel";
import { Delta, DirectionBadge, KpiCard, Panel } from "@/components/ui/basics";
import { Avatar, DonutChart, SERIES, StackBar } from "@/components/ui/charts";
import { Icon } from "@/components/ui/Icon";
import { RangeNotice } from "@/components/ui/RangeNotice";
import { ErrorBox, Loading } from "@/components/ui/State";
import { api, type Dashboard } from "@/lib/api";
import { moneyCompact, money, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

export default function DashboardPage() {
  const { range } = useRange();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.dashboard(range), [range.from, range.to]);
  return (
    <>
      <RangeNotice />

      {loading && !data && <Loading label="Loading dashboard" />}
      {error && <ErrorBox message={error} status={errorStatus} onRetry={reload} />}
      {data && <DashboardBody data={data} />}
    </>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const k = data.kpis;
  const top = data.value_by_category.slice(0, 5);
  const hidden = data.value_by_category.length - top.length;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon="events" tone="info" label="Total events" value={k.total_events} href="/events" facts={[`${k.open_events} open`, `${k.total_events - k.open_events} closed`]} />
        <KpiCard icon="cube" tone="brand" label="Items & lots" value={k.items} href="/comparison" facts={[`${k.vendors} vendors`]} />
        <KpiCard icon="coin" tone="amber" label="Total value" value={moneyCompact(k.total_value)} href="/reports" facts={["Quoted or final"]} />
        <KpiCard icon="trend" tone="ok" label="Potential" value={moneyCompact(k.potential_total)} href="/comparison" facts={[`${moneyCompact(k.potential_savings)} savings`, `${moneyCompact(k.potential_uplift)} uplift`]} />
        <KpiCard icon="chat" tone="amber" label="In negotiation" value={k.negotiations_in_progress} href="/negotiations" facts={["Negotiating or awaiting approval"]} />
        <KpiCard icon="check" tone="ok" label="Completed" value={k.completed_negotiations} href="/history" facts={[`${moneyCompact(k.realised_total)} generated`]} />
      </div>

      <EventsPanel
        events={data.events}
        limit={10}
        footer={
          <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
            <span>Latest 10 shown</span>
            <Link href="/events" className="font-semibold text-brand hover:underline">
              View all events
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Value by category">
          <DonutChart
            label="Value by category"
            centerTop={moneyCompact(k.total_value)}
            centerBottom="Total value"
            total={1}
            stats={[
              { label: "Categories", value: String(data.value_by_category.length) },
              { label: "Total value", value: moneyCompact(k.total_value) },
              { label: "Largest share", value: top[0] ? pct(top[0].share, 0) : "—" },
            ]}
            segments={top.map((c, i) => ({
              label: c.category.replace(/^\d+ - /, ""),
              value: c.share,
              color: SERIES[i % SERIES.length],
              valueText: moneyCompact(c.value),
              percentText: pct(c.share, 0),
            }))}
          />
          {hidden > 0 && <p className="mt-2 text-xs text-muted">+ {hidden} smaller categories</p>}
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Top vendors">
            <ol className="grid gap-2.5">
              {data.top_vendors.map((v, i) => (
                <li key={v.vendor_id} className="flex items-center gap-3">
                  <Avatar name={v.vendor_name} index={i} />
                  <Link href={`/vendors/${v.vendor_id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                    {v.vendor_name}
                  </Link>
                  <span className="text-right text-sm tabular-nums">
                    <span className="block font-semibold text-ink">{moneyCompact(v.value)}</span>
                    <span className="text-xs text-muted">{pct(v.share)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Pipeline & results">
            <StackBar
              label="Events by status"
              segments={[
                { label: "Received", value: data.status_distribution.received ?? 0, color: "var(--c2)" },
                { label: "In progress", value: data.status_distribution.in_progress ?? 0, color: "var(--c3)" },
                { label: "Closed", value: data.status_distribution.closed ?? 0, color: "var(--c1)" },
              ]}
            />
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line2 pt-3 text-sm">
              <div>
                <div className="text-xs text-muted">Savings generated</div>
                <div className="font-bold text-ok tabular-nums">{money(data.delta_generated.savings)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Uplift generated</div>
                <div className="font-bold text-ok tabular-nums">{money(data.delta_generated.uplift)}</div>
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:col-span-2 xl:col-span-1">
          <Panel title="Negotiation opportunities">
            {data.opportunities.length === 0 ? (
              <p className="text-sm text-muted">None yet. Analyze quotes on an event to see them here.</p>
            ) : (
              <ul className="grid gap-2.5">
                {data.opportunities.slice(0, 5).map((o) => (
                  <li key={o.item_id}>
                    <Link href={`/items/${o.item_id}`} className="block rounded-m border border-line2 px-3 py-2.5 hover:border-brand">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-ink">{o.description}</span>
                        <DirectionBadge direction={o.direction} />
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{o.title}</span>
                        <Delta value={o.potential_delta} direction={o.direction} label />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.insight && (
            <div className="rounded-card border border-line bg-brand-soft p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-m bg-panel text-brand">
                  <Icon name="bulb" />
                </span>
                <div className="min-w-0 text-sm">
                  <b className="block text-ink">Insight</b>
                  <p className="mt-1 text-text">
                    {data.insight.description} has the widest gap between vendor bids ({pct(data.insight.spread)}).
                  </p>
                  <Link href={`/items/${data.insight.item_id}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                    Open item
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
