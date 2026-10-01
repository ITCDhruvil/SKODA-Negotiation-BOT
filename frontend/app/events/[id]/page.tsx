"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Delta, DirectionBadge, KpiCard, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type EventDetail, type ItemView } from "@/lib/api";
import { dateShort, money, moneyCompact, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
  SESSION_LABEL,
  SESSION_TONE,
  STATE_LABEL,
  STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  deltaLabel,
  quoteLabel,
  quotesLabel,
} from "@/lib/labels";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function EventNegotiations({ eventId }: { eventId: string }) {
  const { data } = useApi(() => api.negotiations(), [eventId]);
  const rows = (data ?? []).filter((r) => r.event_id === eventId);
  return (
    <Panel title="Negotiations on this event" subtitle="Conversations with vendors, newest first." flush>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">None yet. Open an item, analyze its quotes, then start a negotiation.</p>
      ) : (
        <ul className="divide-y divide-line2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink">{r.item_description}</div>
                <div className="text-xs text-muted">{r.vendor_name}</div>
              </div>
              <span className="font-semibold tabular-nums">{money(r.agreed_price ?? r.vendor_offer)}</span>
              <Pill tone={SESSION_TONE[r.status]}>{SESSION_LABEL[r.status]}</Pill>
              <Link href={`/negotiate/${r.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
                {r.status === "active" ? "Open" : "View"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Body({ data }: { data: EventDetail }) {
  const e = data.event;
  const closed = e.status === "closed";
  const columns: Column<ItemView>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <Link href={`/items/${i.id}`} className="font-semibold text-brand hover:underline">
          {i.description}
        </Link>
      ),
    },
    { key: "qty", header: "Qty", align: "right", cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "bids", header: quotesLabel(e.direction), align: "right", hideOnMobile: true, cell: (i) => i.bid_count },
    { key: "best", header: `Best ${quoteLabel(e.direction).toLowerCase()}`, align: "right", cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    { key: "target", header: "Target", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{money(i.target)}</span> },
    { key: "gap", header: "Gap / unit", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{i.gap == null ? "—" : money(i.gap)}</span> },
    {
      key: "potential",
      header: `Potential ${deltaLabel(e.direction).toLowerCase()}`,
      align: "right",
      cell: (i) => <Delta value={i.potential_delta} direction={e.direction} />,
    },
    { key: "state", header: "Status", cell: (i) => <Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill> },
    {
      key: "rec",
      header: "Recommendation",
      hideOnMobile: true,
      cell: (i) => <Pill tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (i) => (
        <Link href={`/items/${i.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
          Open
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/events" className="hover:underline">Events</Link> / {e.id}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.title}
            <DirectionBadge direction={e.direction} />
            <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
          </span>
        }
        subtitle={e.category}
        actions={
          closed ? (
            <a
              href={api.exportUrl(e.id)}
              download
              className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand"
            >
              {e.direction === "buy" ? "Download Shopping Cart template (CSV)" : "Download deal summary (CSV)"}
            </a>
          ) : data.items.some((i) => i.state === "awaiting_approval") ? (
            <Link href={`/events/${e.id}/approve`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">
              Review &amp; approve
            </Link>
          ) : undefined
        }
      />

      {!e.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">
            Not eligible for negotiation: {e.eligibility.reason}. You can review it, but negotiation points cannot be confirmed.
          </Notice>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="cube" tone="brand" label="Items" value={e.item_count} />
        <KpiCard icon="vendors" tone="info" label="Vendors" value={e.vendor_count} sub="Invited or responded" />
        <KpiCard icon="coin" tone="amber" label={closed ? "Final value" : "Quoted value"} value={moneyCompact(closed ? (e.final_value ?? e.quoted_value) : e.quoted_value)} sub={closed ? `Original ${moneyCompact(e.original_value)}` : `Reference ${moneyCompact(e.reference_value)}`} />
        <KpiCard
          icon="trend"
          tone="ok"
          label={closed ? `${deltaLabel(e.direction)} achieved` : `Potential ${deltaLabel(e.direction).toLowerCase()}`}
          value={moneyCompact(closed ? e.realised_delta : e.potential_delta)}
        />
      </div>

      {closed && (
        <div className="mb-5">
          <Panel title="Closed summary" subtitle="What this event delivered">
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <Meta label="Original value" value={money(e.original_value)} />
              <Meta label="Final value" value={money(e.final_value)} />
              <Meta label={`${deltaLabel(e.direction)} achieved`} value={money(e.realised_delta)} />
              <Meta label="Items negotiated" value={`${e.items_negotiated} / ${e.item_count}`} />
              <Meta label="Negotiation time" value={`${e.duration_minutes} min · ${e.vendors_participated} vendors`} />
            </dl>
          </Panel>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Items" subtitle="Open an item to set points, see its vendors and quotes, negotiate and read the conversation history." flush>
          <DataTable columns={columns} rows={data.items} rowKey={(i) => i.id} />
        </Panel>
        <div className="grid content-start gap-5">
        <EventNegotiations eventId={e.id} />
        <Panel title="Details">
          <dl className="grid gap-3 text-sm">
            <Meta label="Reference value" value={money(e.reference_value)} />
            <Meta label="Plant / company" value={`${e.plant} · ${e.company}`} />
            <Meta label="Purchasing" value={`${e.purch_org} · ${e.purch_group}`} />
            <Meta label="Requestor" value={e.requestor} />
            <Meta label="Cost centre" value={e.cost_centre} />
            <Meta label="Created" value={dateShort(e.created)} />
            <Meta label="Approved" value={dateShort(e.approval_date)} />
            <Meta label="Due" value={dateShort(e.due)} />
            <Meta label="Source cart" value={e.source_cart_no ?? "Scrap sale (no cart)"} />
          </dl>
        </Panel>
        </div>
      </div>
    </>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.event(id), [id]);
  if (loading && !data) return <Loading label="Loading event" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  return (
    <>
      {error && (
        <div className="mb-4">
          <Notice tone="red">Could not refresh: {error}</Notice>
        </div>
      )}
      <Body data={data} />
    </>
  );
}
