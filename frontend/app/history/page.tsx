"use client";

import Link from "next/link";
import { useState } from "react";
import { DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { TableToolbar, IconLink } from "@/components/ui/TableToolbar";
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
    { key: "date", header: "Date", sort: (h) => h.date, cell: (h) => dateShort(h.date) },
    { key: "item", header: "Item", sort: (h) => h.description.toLowerCase(), cell: (h) => <span className="font-semibold text-ink">{h.description}</span> },
    { key: "type", header: "Type", sort: (h) => h.direction, cell: (h) => <DirectionBadge direction={h.direction} /> },
    {
      key: "vendor",
      header: "Vendor",
      sort: (h) => h.vendor_name.toLowerCase(),
      hideOnMobile: true,
      cell: (h) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_name}</Link>,
    },
    { key: "qty", header: "Qty", align: "right", sort: (h) => h.qty, hideOnMobile: true, cell: (h) => `${num(h.qty)} ${h.unit}` },
    { key: "price", header: "Price", align: "right", sort: (h) => h.unit_price, cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    {
      key: "before",
      header: "Before negotiation",
      align: "right",
      sort: (h) => h.original_price,
      hideOnMobile: true,
      cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>),
    },
    {
      key: "gain",
      header: "Gain",
      align: "right",
      sort: (h) => h.value_delta,
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
      <Panel flush>
        <TableToolbar
          search={{ value: q, onChange: setQ, placeholder: "Search history" }}
          filters={[
            {
              key: "type",
              label: "Type",
              value: direction,
              onChange: setDirection,
              options: [{ value: "", label: "All" }, { value: "buy", label: "Purchase" }, { value: "sell", label: "Scrap" }],
            },
            {
              key: "negotiated",
              label: "Negotiated",
              value: negotiated,
              onChange: setNegotiated,
              options: [{ value: "", label: "All deals" }, { value: "yes", label: "Negotiated only" }, { value: "no", label: "Not negotiated" }],
            },
          ]}
          right={data ? <span>{data.length} deals</span> : null}
        />
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
