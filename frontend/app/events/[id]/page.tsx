"use client";

import Link from "next/link";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { Icon } from "@/components/ui/Icon";
import { useParams } from "next/navigation";
import { Button, ButtonLink, Delta, DirectionBadge, KpiCard, Panel, Pill } from "@/components/ui/basics";
import { inAis, openCaseInAis } from "@/lib/ais";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { IconLink } from "@/components/ui/TableToolbar";
import { MenuInfo, RowMenu } from "@/components/ui/RowMenu";
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
  BAND_LABEL,
  DEAL_LABEL,
  DEAL_TONE,
  tenureLabel,
  BAND_TONE,
  deltaLabel,
  quoteLabel,
  quotesLabel,
} from "@/lib/labels";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(96px,128px)_minmax(0,1fr)] items-baseline gap-3 border-b border-line2 py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

const DOC_KIND: Record<string, string> = { offer: "Supplier offer", sfo: "SFO", comparison: "Comparison sheet", other: "Document" };

/** What the AIS request sent with the case: its details and its files. */
function FromAis({ eventId }: { eventId: string }) {
  const { data } = useApi(() => api.aisInfo(eventId), [eventId]);
  if (!data || (data.details.length === 0 && data.documents.length === 0)) return null;
  return (
    <Panel title="From the AIS request">
      {data.details.length > 0 && (
        <dl className="grid gap-x-10 2xl:grid-cols-2">
          {data.details.map((d) => (
            <Meta key={d.label} label={d.label} value={d.value || "—"} />
          ))}
        </dl>
      )}
      {data.documents.length > 0 && (
        <div className={data.details.length > 0 ? "mt-5" : ""}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Files</h3>
          <ul className="divide-y divide-line2 rounded-m border border-line">
            {data.documents.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{f.name}</div>
                  <div className="text-xs text-muted">
                    {DOC_KIND[f.kind] ?? f.kind}
                    {f.supplier_name ? ` · ${f.supplier_name}` : ""} · {Math.max(1, Math.round(f.size / 1024))} KB
                    {f.generated ? " · summary built by AIS from the offer data" : ""}
                  </div>
                </div>
                <a href={api.documentUrl(f.id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">Open</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function EventNegotiations({ eventId }: { eventId: string }) {
  const { data } = useApi(() => api.negotiations(), [eventId]);
  const rows = (data ?? []).filter((r) => r.event_id === eventId);
  return (
    <Panel title="Negotiations on this event" flush>
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
              <IconLink href={`/negotiate/${r.id}`} icon={r.status === "active" ? "chat" : "eye"} label={r.status === "active" ? "Open conversation" : "View conversation"} />
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
      sort: (i) => i.description.toLowerCase(),
      cell: (i) => (
        <Link href={`/items/${i.id}`} className="block min-w-[120px] font-semibold text-brand hover:underline">
          {i.description}
        </Link>
      ),
    },
    { key: "qty", header: "Qty", align: "right", className: "w-[1%] whitespace-nowrap", sort: (i) => i.qty, cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "best", header: `Best ${quoteLabel(e.direction).toLowerCase()}`, align: "right", className: "w-[1%] whitespace-nowrap", sort: (i) => i.best_bid, cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    {
      key: "potential",
      sort: (i) => i.potential_delta,
      header: "Potential",
      align: "right",
      className: "w-[1%] whitespace-nowrap",
      cell: (i) => <Delta value={i.potential_delta} direction={e.direction} />,
    },
    { key: "deal", header: "Deal", align: "center", className: "w-[1%] whitespace-nowrap", sort: (i) => i.deal_status, cell: (i) => <Pill tone={DEAL_TONE[i.deal_status]}>{DEAL_LABEL[i.deal_status]}</Pill> },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (i) => (
        <RowMenu
          label={`More about ${i.description}`}
          headerHeight={250}
          header={
            <MenuInfo
              rows={[
                ["Quotes", i.bid_count],
                ["Target", money(i.target)],
                ["Gap / unit", i.gap == null ? "—" : money(i.gap)],
                ["Term", tenureLabel(i.tenure_months)],
                ["Handled by", <Pill key="h" tone={BAND_TONE[i.policy.band]}>{BAND_LABEL[i.policy.band]}</Pill>],
                ["Status", <Pill key="s" tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill>],
                ["Recommendation", <Pill key="r" tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill>],
              ]}
            />
          }
          items={[
            ...(i.state === "closed"
              ? [{ label: "Download contract", hint: "Print or save the contract as PDF", href: `/events/${e.id}/contract?print=1`, icon: "download" as const }]
              : []),
            { label: "Details", hint: "Quantity, target, limit and status", href: `/items/${i.id}`, icon: "eye" },
            { label: "Compare vendors", hint: "Quotes side by side", href: `/items/${i.id}?tab=quotes`, icon: "comparison" },
            { label: "Price history", hint: "Past deals and trend", href: `/items/${i.id}?tab=history`, icon: "history" },
            { label: "Conversations", hint: "Messages with each vendor", href: `/items/${i.id}?tab=negotiation`, icon: "chat" },
          ]}
        />
      ),
    },
  ];

  const actionsFor = (
          closed ? (
            <ButtonLink href={`/events/${e.id}/contract?print=1`} variant="primary" size="md">
              <span className="inline-flex items-center gap-2">
                <Icon name="download" size={16} />
                Contract
              </span>
            </ButtonLink>
          ) : data.items.some((i) => i.state === "awaiting_approval") ? (
            <Link href={`/events/${e.id}/approve`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">
              Review &amp; approve
            </Link>
          ) : undefined
  );
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
          <div className="flex flex-wrap items-center gap-2">
            {e.from_ais && inAis() && (
              <Button onClick={() => openCaseInAis(e.id)} aria-label="Open case in AIS" title="Open case in AIS">
                <span className="inline-flex items-center gap-2">
                  <Icon name="external" size={15} />
                  AIS
                </span>
              </Button>
            )}
            {actionsFor}
          </div>
        }
      />

      {!e.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">
            Not eligible for negotiation: {e.eligibility.reason}. You can review it, but negotiation points cannot be confirmed.
          </Notice>
        </div>
      )}

      <KpiGrid className="mb-5">
        <KpiCard icon="cube" tone="brand" label="Items" value={e.item_count} sub="Lots in this event" />
        <KpiCard icon="vendors" tone="info" label="Vendors" value={e.vendor_count} sub="Invited or responded" />
        <KpiCard icon="coin" tone="amber" label={closed ? "Final value" : "Quoted value"} value={moneyCompact(closed ? (e.final_value ?? e.quoted_value) : e.quoted_value)} sub={closed ? `Original ${moneyCompact(e.original_value)}` : `Reference ${moneyCompact(e.reference_value)}`} />
        <KpiCard
          icon="trend"
          tone="ok"
          label={closed ? `${deltaLabel(e.direction)} achieved` : `Potential ${deltaLabel(e.direction).toLowerCase()}`}
          value={moneyCompact(closed ? e.realised_delta : e.potential_delta)}
          sub={closed ? `${deltaLabel(e.direction)} against the original quote` : "If it closes at target"}
        />
        {closed && <KpiCard icon="check" tone="ok" label="Items negotiated" value={`${e.items_negotiated} / ${e.item_count}`} sub="Closed with a deal" />}
        {closed && <KpiCard icon="history" tone="info" label="Negotiation time" value={`${e.duration_minutes} min`} sub={`${e.vendors_participated} vendors took part`} />}
      </KpiGrid>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-5">
          <Panel title="Items" flush>
            <DataTable columns={columns} rows={data.items} rowKey={(i) => i.id} noScroll />
          </Panel>
          {e.from_ais && <FromAis eventId={e.id} />}
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <EventNegotiations eventId={e.id} />
          <Panel title="Details">
            <dl>
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
