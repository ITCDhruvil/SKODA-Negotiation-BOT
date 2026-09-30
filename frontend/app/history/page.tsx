"use client";

import Link from "next/link";
import { useState } from "react";
import { DirectionBadge, inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type HistoryRow } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel } from "@/lib/labels";

export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState("");
  const [negotiated, setNegotiated] = useState("");
  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.history({ q, direction, negotiated: negotiated === "" ? undefined : negotiated === "yes", limit: 500 }),
    [q, direction, negotiated],
  );

  const columns: Column<HistoryRow>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "item", header: "Item", cell: (h) => <span className="font-semibold text-ink">{h.description}</span> },
    { key: "type", header: "Type", cell: (h) => <DirectionBadge direction={h.direction} /> },
    {
      key: "vendor",
      header: "Vendor",
      hideOnMobile: true,
      cell: (h) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_name}</Link>,
    },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => `${num(h.qty)} ${h.unit}` },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    {
      key: "before",
      header: "Before negotiation",
      align: "right",
      hideOnMobile: true,
      cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>),
    },
    {
      key: "gain",
      header: "Gain",
      align: "right",
      cell: (h) =>
        h.value_delta == null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="tabular-nums font-semibold text-ok">
            {money(h.value_delta)}
            <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(h.direction)}</span>
          </span>
        ),
    },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];

  return (
    <>
      <PageHeader title="History" subtitle="Closed deals from the last eighteen months. The bot may only cite figures found here." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item…" aria-label="Search history" className={`${inputClass} max-w-sm`} />
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">Buy and sell</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={negotiated} onChange={(e) => setNegotiated(e.target.value)} aria-label="Negotiated" className={`${inputClass} w-auto`}>
            <option value="">All deals</option>
            <option value="yes">Negotiated only</option>
            <option value="no">Not negotiated</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} deals</span>}
        </div>
        {loading && !data && <Loading label="Loading history" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} status={errorStatus} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={data} rowKey={(h) => h.id} empty="No deals match." dense />}
      </Panel>
    </>
  );
}
