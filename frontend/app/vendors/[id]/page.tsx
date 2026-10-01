"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { KpiCard, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type HistoryPoint, type VendorDetail } from "@/lib/api";
import { dateShort, money, moneyCompact, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type BidRow = VendorDetail["recent_bids"][number];

function Body({ data }: { data: VendorDetail }) {
  const v = data.vendor;
  const bidColumns: Column<BidRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (b) => (
        <Link href={`/items/${b.item_id}`} className="font-semibold text-brand hover:underline">
          {b.description}
        </Link>
      ),
    },
    { key: "qty", header: "Qty", align: "right", cell: (b) => num(b.qty) },
    { key: "price", header: "Quote", align: "right", cell: (b) => <span className="tabular-nums font-semibold">{money(b.unit_price)}</span> },
    { key: "event", header: "Event", hideOnMobile: true, cell: (b) => <Link href={`/events/${b.event_id}`} className="text-muted hover:underline">{b.event_id}</Link> },
  ];
  const histColumns: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "item", header: "Item", cell: (h) => h.description },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => num(h.qty) },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];
  return (
    <>
      <PageHeader
        crumbs={<><Link href="/vendors" className="hover:underline">Vendors</Link> / {v.name}</>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {v.name}
            <Pill tone={v.type === "supplier" ? "info" : "amber"}>{v.type === "supplier" ? "Supplier" : "Scrap buyer"}</Pill>
          </span>
        }
        subtitle={`SAP ${v.sap_no} · payment preference ${v.payment_pref}`}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="check" tone="ok" label="Rating" value={v.rating.toFixed(1)} sub="Out of 5" />
        <KpiCard icon="chat" tone="info" label="Live quotes" value={v.live_bid_count} sub={moneyCompact(v.quoted_value)} />
        <KpiCard icon="cube" tone="brand" label="Closed with us" value={v.closed_deals} />
        <KpiCard icon="history" tone="amber" label="Past deals" value={v.past_deals} sub={`${v.history_deals} in the history log`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Current quotes"
          flush
        >
          <DataTable columns={bidColumns} rows={data.recent_bids} rowKey={(b) => `${b.item_id}`} empty="No live quotes." dense />
        </Panel>
        <Panel title="Past deals" flush>
          <DataTable columns={histColumns} rows={data.history.slice(0, 15)} rowKey={(h) => h.id} empty="No past deals." dense />
        </Panel>
      </div>
    </>
  );
}

export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.vendor(id), [id]);
  if (loading && !data) return <Loading label="Loading vendor" />;
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
