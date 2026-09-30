"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventsTable } from "@/components/events/EventsTable";
import { Delta, DirectionBadge, KpiCard, Panel } from "@/components/ui/basics";
import { Avatar, Donut, Legend, SERIES, StackBar } from "@/components/ui/charts";
import { Icon } from "@/components/ui/Icon";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type Dashboard, type Direction } from "@/lib/api";
import { moneyCompact, money, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

type Filter = "all" | "buy" | "sell" | "open" | "closed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "buy", label: "Buy" },
  { key: "sell", label: "Sell" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { range } = useRange();
  const { data, error, loading, reload } = useApi(() => api.dashboard(range), [range.from, range.to]);
  const [hello, setHello] = useState("Welcome");
  const [filter, setFilter] = useState<Filter>("all");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setHello(greeting()), []);

  const simulate = async (direction: Direction, menu: HTMLDetailsElement | null) => {
    menu?.removeAttribute("open");
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.simulate(direction);
      setCreated(res.event.id);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${hello}, Dhruvil`}
        subtitle="Here is an overview of your sourcing events and negotiation progress."
        actions={
          <details className="relative">
            <summary
              className={`inline-flex cursor-pointer list-none items-center gap-2 rounded-m bg-brand px-4 py-2 text-sm font-semibold text-white dark:text-[#07130f] ${busy ? "opacity-60" : ""}`}
            >
              <Icon name="plus" size={16} /> Simulate event
            </summary>
            <div className="absolute right-0 z-30 mt-2 grid w-56 gap-1 rounded-l border border-line bg-panel p-2 shadow-pop">
              <button
                className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise"
                onClick={(e) => simulate("buy", e.currentTarget.closest("details"))}
              >
                New BUY cart
                <span className="block text-xs font-normal text-muted">Services or goods from suppliers</span>
              </button>
              <button
                className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise"
                onClick={(e) => simulate("sell", e.currentTarget.closest("details"))}
              >
                New SELL scrap lot
                <span className="block text-xs font-normal text-muted">Scrap for bidding buyers</span>
              </button>
            </div>
          </details>
        }
      />

      {created && (
        <div className="mb-4">
          <Notice tone="ok">
            Created <Link href={`/events/${created}`} className="font-semibold underline">{created}</Link> as a new draft event.
          </Notice>
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <Notice tone="red">{actionError}</Notice>
        </div>
      )}

      {loading && !data && <Loading label="Loading dashboard" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DashboardBody data={data} filter={filter} setFilter={setFilter} />}
    </>
  );
}

function DashboardBody({ data, filter, setFilter }: { data: Dashboard; filter: Filter; setFilter: (f: Filter) => void }) {
  const k = data.kpis;
  const events = data.events.filter((e) =>
    filter === "all" ? true : filter === "buy" || filter === "sell" ? e.direction === filter : filter === "open" ? e.status !== "closed" : e.status === "closed",
  );
  const top = data.value_by_category.slice(0, 5);
  const hidden = data.value_by_category.length - top.length;

  return (
    <div className="grid gap-5">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard icon="events" tone="info" label="Total events" value={k.total_events} sub={`${k.open_events} still open`} />
      <KpiCard icon="cube" tone="brand" label="Items & lots" value={k.items} sub={`${k.vendors} vendors on record`} />
      <KpiCard icon="coin" tone="amber" label="Total value" value={moneyCompact(k.total_value)} sub="Quoted where bids exist, else reference" />
      <KpiCard
        icon="trend"
        tone="ok"
        label="Potential savings / uplift"
        value={moneyCompact(k.potential_total)}
        sub={`${moneyCompact(k.potential_savings)} savings · ${moneyCompact(k.potential_uplift)} uplift`}
      />
      <KpiCard icon="events" tone="info" label="Open events" value={k.open_events} sub="Not yet closed" />
      <KpiCard icon="vendors" tone="brand" label="Vendors" value={k.vendors} sub="Suppliers and scrap buyers" />
      <KpiCard icon="chat" tone="amber" label="Negotiations in progress" value={k.negotiations_in_progress} sub="Items being negotiated or awaiting approval" />
      <KpiCard
        icon="check"
        tone="ok"
        label="Completed negotiations"
        value={k.completed_negotiations}
        sub={`${moneyCompact(k.realised_total)} generated`}
      />
    </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid min-w-0 content-start gap-5">
        <Panel
          title="Events"
          subtitle="Buy carts and scrap sales, with the value on the table and where they stand."
          flush
          actions={
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter events">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    filter === f.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        >
          <EventsTable events={events.slice(0, 10)} empty="No events in this filter." />
          <div className="flex items-center justify-between px-5 py-3 text-xs text-muted">
            <span>
              Showing {Math.min(10, events.length)} of {events.length}
            </span>
            <Link href="/events" className="font-semibold text-brand hover:underline">
              View all events
            </Link>
          </div>
        </Panel>
      </div>

      <div className="grid content-start gap-5">
        <Panel title="Value by category" subtitle="Share of total quoted value">
          <Donut
            label="Value by category"
            centerTop={moneyCompact(k.total_value)}
            centerBottom="Total value"
            segments={top.map((c, i) => ({ label: c.category, value: c.share, color: SERIES[i % SERIES.length] }))}
            total={1}
          />
          <div className="mt-4">
            <Legend
              rows={top.map((c, i) => ({
                color: SERIES[i % SERIES.length],
                label: c.category.replace(/^\d+ - /, ""),
                right: `${pct(c.share, 0)} · ${moneyCompact(c.value)}`,
              }))}
            />
            {hidden > 0 && <p className="mt-2 text-xs text-muted">+ {hidden} smaller categories</p>}
          </div>
        </Panel>

        <Panel title="Top vendors by quoted value">
          <ol className="grid gap-3">
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

        <Panel title="Negotiation opportunities" subtitle="Best quote is still short of your target">
          {data.opportunities.length === 0 ? (
            <p className="text-sm text-muted">No open opportunities yet. Analyze quotes on an event to see them here.</p>
          ) : (
            <ul className="grid gap-3">
              {data.opportunities.slice(0, 5).map((o) => (
                <li key={o.item_id}>
                  <Link href={`/items/${o.item_id}`} className="block rounded-m border border-line2 p-3 hover:border-brand">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-ink">{o.description}</span>
                      <DirectionBadge direction={o.direction} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{o.title}</span>
                      <Delta value={o.potential_delta} direction={o.direction} label />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pipeline & results">
          <StackBar
            label="Events by status"
            segments={[
              { label: "Received", value: data.status_distribution.received ?? 0, color: "var(--info)" },
              { label: "In progress", value: data.status_distribution.in_progress ?? 0, color: "var(--amber)" },
              { label: "Closed", value: data.status_distribution.closed ?? 0, color: "var(--ok)" },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line2 pt-4 text-sm">
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

        {data.insight && (
          <div className="rounded-l border border-line bg-brand-soft p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-m bg-panel text-brand">
                <Icon name="bulb" />
              </span>
              <div className="min-w-0 text-sm">
                <b className="block text-ink">Negotiation insight</b>
                <p className="mt-1 text-text">
                  {data.insight.description} has the widest gap between vendor bids ({pct(data.insight.spread)}). A good
                  opportunity for price optimisation.
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
