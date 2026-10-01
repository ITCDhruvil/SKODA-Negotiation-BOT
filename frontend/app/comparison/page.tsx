"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Delta, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { TableToolbar, IconLink } from "@/components/ui/TableToolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { RangeNotice } from "@/components/ui/RangeNotice";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type Direction, type ItemRow } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, STATE_LABEL, STATE_TONE, quoteLabel, quotesLabel } from "@/lib/labels";

export default function ComparisonPage() {
  const router = useRouter();
  const [direction, setDirection] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [q, setQ] = useState("");
  const { range } = useRange();
  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.items({ has_bids: true, direction, recommendation, date_from: range.from, date_to: range.to }),
    [direction, recommendation, range.from, range.to],
  );
  const rows = (data ?? []).filter((i) => !q || `${i.description} ${i.event_title}`.toLowerCase().includes(q.toLowerCase()));
  // Quote or bid wording follows the type filter; with both types shown the neutral word is used.
  const only: Direction | null = direction === "buy" || direction === "sell" ? direction : null;

  const columns: Column<ItemRow>[] = [
    {
      key: "item",
      header: "Item",
      sort: (i) => i.description.toLowerCase(),
      cell: (i) => (
        <div className="max-w-[260px]">
          <Link href={`/items/${i.id}`} className="block truncate font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
            {i.description}
          </Link>
          <div className="truncate text-xs text-muted">{i.event_title}</div>
        </div>
      ),
    },
    { key: "type", header: "Type", sort: (i) => i.direction, cell: (i) => <DirectionBadge direction={i.direction} /> },
    { key: "qty", header: "Qty", align: "right", sort: (i) => i.qty, hideOnMobile: true, cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "bids", header: only ? quotesLabel(only) : "Quotes", align: "right", sort: (i) => i.bid_count, hideOnMobile: true, cell: (i) => i.bid_count },
    { key: "best", header: only ? `Best ${quoteLabel(only).toLowerCase()}` : "Best quote", align: "right", sort: (i) => i.best_bid, cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    { key: "target", header: "Target", align: "right", sort: (i) => i.target, hideOnMobile: true, cell: (i) => <span className="tabular-nums">{money(i.target)}</span> },
    { key: "gap", header: "Gap", align: "right", sort: (i) => i.gap, hideOnMobile: true, cell: (i) => <span className="tabular-nums">{i.gap == null ? "—" : money(i.gap)}</span> },
    { key: "delta", header: "Potential", align: "right", sort: (i) => i.potential_delta, cell: (i) => <Delta value={i.potential_delta} direction={i.direction} /> },
    { key: "state", header: "Status", hideOnMobile: true, sort: (i) => i.state, cell: (i) => <Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill> },
    { key: "rec", header: "Recommendation", sort: (i) => i.recommendation, cell: (i) => <Pill tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill> },
    { key: "action", header: "", align: "right", cell: (i) => <IconLink href={`/items/${i.id}`} icon="eye" label="View item" /> },
  ];

  return (
    <>
      <RangeNotice />
      <Panel flush>
        <TableToolbar
          search={{ value: q, onChange: setQ, placeholder: "Search items" }}
          filters={[
            {
              key: "type",
              label: "Type",
              value: direction,
              onChange: setDirection,
              options: [{ value: "", label: "All" }, { value: "buy", label: "Purchase" }, { value: "sell", label: "Scrap" }],
            },
            {
              key: "rec",
              label: "Recommendation",
              value: recommendation,
              onChange: setRecommendation,
              options: [
                { value: "", label: "All" },
                { value: "negotiate", label: "Negotiation recommended" },
                { value: "accept", label: "Best quote acceptable" },
                { value: "review", label: "Buyer review needed" },
                { value: "done", label: "Done" },
              ],
            },
          ]}
          right={data ? <span>{rows.length} items</span> : null}
        />
        {loading && !data && <Loading label="Loading comparison" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} status={errorStatus} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={rows} rowKey={(i) => i.id} onRowClick={(i) => router.push(`/items/${i.id}`)} empty="No items match." dense paginate noun="items" />}
      </Panel>
    </>
  );
}
