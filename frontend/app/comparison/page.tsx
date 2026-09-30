"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Delta, DirectionBadge, inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type ItemRow } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, STATE_LABEL, STATE_TONE } from "@/lib/labels";

export default function ComparisonPage() {
  const router = useRouter();
  const [direction, setDirection] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const { data, error, loading, reload } = useApi(
    () => api.items({ has_bids: true, direction, recommendation }),
    [direction, recommendation],
  );

  const columns: Column<ItemRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <div className="max-w-[260px]">
          <Link href={`/items/${i.id}`} className="block truncate font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
            {i.description}
          </Link>
          <div className="truncate text-xs text-muted">{i.event_title}</div>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (i) => <DirectionBadge direction={i.direction} /> },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "bids", header: "Quotes", align: "right", hideOnMobile: true, cell: (i) => i.bid_count },
    { key: "best", header: "Best quote", align: "right", cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    { key: "target", header: "Target", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{money(i.target)}</span> },
    { key: "gap", header: "Gap", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{i.gap == null ? "—" : money(i.gap)}</span> },
    { key: "delta", header: "Potential", align: "right", cell: (i) => <Delta value={i.potential_delta} direction={i.direction} /> },
    { key: "state", header: "Status", hideOnMobile: true, cell: (i) => <Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill> },
    { key: "rec", header: "Recommendation", cell: (i) => <Pill tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill> },
  ];

  return (
    <>
      <PageHeader title="Comparison" subtitle="Every item with vendor quotes, biggest opportunity first. Open one to compare vendors side by side." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">Buy and sell</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} aria-label="Recommendation" className={`${inputClass} w-auto`}>
            <option value="">Any recommendation</option>
            <option value="negotiate">Negotiation recommended</option>
            <option value="accept">Best quote acceptable</option>
            <option value="review">Buyer review needed</option>
            <option value="done">Done</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} items</span>}
        </div>
        {loading && !data && <Loading label="Loading comparison" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={data} rowKey={(i) => i.id} onRowClick={(i) => router.push(`/items/${i.id}`)} empty="No items match." dense />}
      </Panel>
    </>
  );
}
