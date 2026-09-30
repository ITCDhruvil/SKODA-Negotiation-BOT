"use client";

import Link from "next/link";
import { api, type ItemDetail } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { limitLabel } from "@/lib/labels";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill } from "@/components/ui/basics";
import { TrendChart } from "@/components/ui/charts";
import { ErrorBox, Loading } from "@/components/ui/State";
import type { HistoryPoint } from "@/lib/api";

export function HistoryTab({ detail }: { detail: ItemDetail }) {
  const id = detail.item.id;
  const { data, error, loading, reload } = useApi(() => api.itemHistory(id), [id]);
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  if (data.records.length === 0) return <p className="text-sm text-muted">No past deals for this item or category.</p>;

  const s = data.stats!;
  const d = detail.event.direction;
  const refs = [{ value: detail.item.target, label: "Target", color: "var(--ok)" }, { value: detail.item.limit, label: limitLabel(d), color: "var(--amber)" }];
  if (detail.item.best_bid != null) refs.push({ value: detail.item.best_bid, label: "Best quote", color: "var(--info)" });

  const columns: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "desc", header: "Item", hideOnMobile: true, cell: (h) => h.description },
    { key: "vendor", header: "Vendor", cell: (h) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_id}</Link> },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => h.qty },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    { key: "orig", header: "Before negotiation", align: "right", hideOnMobile: true, cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>) },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        {data.basis === "description" ? "Past deals for this exact item." : "No exact match; showing past deals in the same category."}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Deals", String(s.count)],
          ["Average", money(s.average)],
          ["Lowest", money(s.minimum)],
          ["Highest", money(s.maximum)],
          ["Last price", `${money(s.last_price)} · ${dateShort(s.last_date)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-m border border-line2 bg-raise px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-bold text-ink tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <TrendChart
        label="Price trend of past deals"
        points={data.records.map((r) => ({ date: r.date, price: r.unit_price, negotiated: r.negotiated }))}
        refLines={refs}
      />
      <p className="text-xs text-muted">Filled dots were negotiated; hollow dots are list-price deals.</p>
      <DataTable columns={columns} rows={[...data.records].reverse()} rowKey={(h) => h.id} dense />
    </div>
  );
}
