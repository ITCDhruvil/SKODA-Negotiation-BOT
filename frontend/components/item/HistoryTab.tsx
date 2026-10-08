"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api, type HistoryPoint, type ItemDetail } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { limitLabel, quoteLabel } from "@/lib/labels";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard, Pill } from "@/components/ui/basics";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { TrendChart } from "@/components/ui/charts";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { ErrorBox, Loading } from "@/components/ui/State";

const ALL = "__all__";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function HistoryTab({ detail }: { detail: ItemDetail }) {
  const id = detail.item.id;
  const { data, error, errorStatus, loading, reload } = useApi(() => api.itemHistory(id), [id]);
  const [vendor, setVendor] = useState<string>(ALL);

  const vendors = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of data?.records ?? []) m.set(r.vendor_id, { name: r.vendor_name, count: (m.get(r.vendor_id)?.count ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
  }, [data]);

  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  if (data.records.length === 0) return <p className="text-sm text-muted">No past deals for this item or category.</p>;

  const d = detail.event.direction;
  const buy = d === "buy";
  const picked = vendor === ALL || !vendors.some(([v]) => v === vendor) ? ALL : vendor;
  const rows = picked === ALL ? data.records : data.records.filter((r) => r.vendor_id === picked);
  const prices = rows.map((r) => r.unit_price);
  const avg = sum(prices) / rows.length;
  const last = rows[rows.length - 1];
  const negotiated = rows.filter((r) => r.negotiated);
  const moved = (r: HistoryPoint) => (r.original_price == null ? null : buy ? r.original_price - r.unit_price : r.unit_price - r.original_price);
  const movedList = rows.map(moved).filter((x): x is number => x != null && x > 0);
  const avgMoved = movedList.length ? sum(movedList) / movedList.length : null;
  const target = detail.item.target;
  const vsTarget = target ? Math.round(((avg - target) / target) * 100) : null;

  const refs = [{ value: detail.item.target, label: "Target", color: "var(--ok)" }, { value: detail.item.limit, label: limitLabel(d), color: "var(--amber)" }];
  if (detail.item.best_bid != null) refs.push({ value: detail.item.best_bid, label: `Best ${quoteLabel(d).toLowerCase()}`, color: "var(--info)" });

  const columns: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "desc", header: "Item", hideOnMobile: true, cell: (h) => h.description },
    ...(picked === ALL
      ? [{ key: "vendor", header: "Vendor", cell: (h: HistoryPoint) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_name}</Link> }]
      : []),
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => h.qty },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    { key: "orig", header: "Before negotiation", align: "right", hideOnMobile: true, cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>) },
    {
      key: "moved",
      header: buy ? "Brought down" : "Brought up",
      align: "right",
      hideOnMobile: true,
      cell: (h) => {
        const m = moved(h);
        return m != null && m > 0 ? <span className="tabular-nums font-semibold text-ok">{money(m)}</span> : "—";
      },
    },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {data.basis === "description" ? "Past deals for this exact item." : "No exact match; showing past deals in the same category."}
        </p>
        <span className="text-xs text-muted">
          {data.records.length} {data.records.length === 1 ? "deal" : "deals"} with {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <Tabs
          idPrefix="hist"
          variant="chips"
          value={picked}
          onChange={setVendor}
          tabs={[
            { key: ALL, label: `All vendors (${data.records.length})` },
            ...vendors.map(([v, x]) => ({ key: v, label: `${x.name} (${x.count})` })),
          ]}
        />
      </div>

      <div role="tabpanel" id={panelId("hist", picked)} aria-labelledby={tabId("hist", picked)} className="grid gap-5">
        <KpiGrid>
          <KpiCard icon="list" tone="info" label="Deals" value={rows.length} sub={`${negotiated.length} negotiated`} />
          <KpiCard
            icon="coin"
            label="Average price"
            value={money(avg)}
            sub={vsTarget == null ? undefined : vsTarget === 0 ? "On target" : `${Math.abs(vsTarget)}% ${vsTarget > 0 ? "above" : "below"} target`}
          />
          <KpiCard icon="trend" tone="ok" label={buy ? "Lowest" : "Lowest price"} value={money(Math.min(...prices))} sub={`Highest ${money(Math.max(...prices))}`} />
          <KpiCard icon="tag" tone="info" label="Last price" value={money(last.unit_price)} sub={`${dateShort(last.date)}${picked === ALL ? ` · ${last.vendor_name}` : ""}`} />
          <KpiCard
            icon="check"
            tone="ok"
            label={buy ? "Usually brought down" : "Usually brought up"}
            value={avgMoved == null ? "—" : money(Math.round(avgMoved))}
            sub={movedList.length ? `per unit, over ${movedList.length} ${movedList.length === 1 ? "deal" : "deals"}` : "No negotiated deals"}
          />
        </KpiGrid>

        <TrendChart
          label={picked === ALL ? "Price trend of past deals" : `Price trend with ${vendors.find(([v]) => v === picked)?.[1].name}`}
          points={rows.map((r) => ({ date: r.date, price: r.unit_price, negotiated: r.negotiated, label: r.vendor_name }))}
          refLines={refs}
          goodWhen={buy ? "down" : "up"}
        />
        <DataTable columns={columns} rows={[...rows].reverse()} rowKey={(h) => h.id} dense />
      </div>
    </div>
  );
}
