"use client";

import Link from "next/link";
import { DashboardKpis } from "@/components/dashboard/DashboardKpis";
import { OpportunitiesInsights } from "@/components/dashboard/OpportunitiesInsights";
import { EventsPanel } from "@/components/events/EventsPanel";
import { Panel } from "@/components/ui/basics";
import { Avatar, DonutChart, SERIES, StackBar } from "@/components/ui/charts";
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
      <DashboardKpis k={k} events={data.events} opportunities={data.opportunities} />

      <EventsPanel events={data.events} paginate />

      <OpportunitiesInsights data={data} />

      <div className="grid items-start gap-4 md:grid-cols-2">
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
      </div>
    </div>
  );
}
