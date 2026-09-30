"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventView } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { STATUS_LABEL, STATUS_TONE, deltaLabel } from "@/lib/labels";
import { DirectionBadge, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";

export function EventsTable({ events, empty }: { events: EventView[]; empty?: string }) {
  const router = useRouter();
  const columns: Column<EventView>[] = [
    {
      key: "id",
      header: "Event #",
      cell: (e) => (
        <Link href={`/events/${e.id}`} className="font-semibold text-brand hover:underline" onClick={(ev) => ev.stopPropagation()}>
          {e.id}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Title",
      cell: (e) => (
        <div className="max-w-[260px]">
          <div className="truncate font-semibold text-ink" title={e.title}>
            {e.title}
          </div>
          <div className="text-xs text-muted">{dateShort(e.created)}</div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideOnMobile: true,
      cell: (e) => (
        <span className="block max-w-[180px] truncate text-muted" title={e.category}>
          {e.category}
        </span>
      ),
    },
    { key: "type", header: "Type", cell: (e) => <DirectionBadge direction={e.direction} /> },
    { key: "items", header: "Items", align: "right", hideOnMobile: true, cell: (e) => e.item_count },
    { key: "vendors", header: "Vendors", align: "right", hideOnMobile: true, cell: (e) => e.vendor_count },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (e) => <span className="tabular-nums">{money(e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value)}</span>,
    },
    {
      key: "delta",
      header: "Potential",
      align: "right",
      hideOnMobile: true,
      cell: (e) =>
        e.status === "closed" ? (
          <span className="tabular-nums font-semibold text-ok">
            {money(e.realised_delta)}
            <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(e.direction)} achieved</span>
          </span>
        ) : e.potential_delta > 0 ? (
          <span className="tabular-nums font-semibold text-ok">{money(e.potential_delta)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (e) => (
        <div className="grid gap-1">
          <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
          {!e.eligibility.eligible && (
            <span title={e.eligibility.reason}>
              <Pill tone="red">Not eligible</Pill>
            </span>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      cell: (e) => (
        <Link
          href={`/events/${e.id}`}
          onClick={(ev) => ev.stopPropagation()}
          className="inline-flex rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand"
        >
          View
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={events}
      rowKey={(e) => e.id}
      onRowClick={(e) => router.push(`/events/${e.id}`)}
      empty={empty ?? "No events match."}
    />
  );
}
