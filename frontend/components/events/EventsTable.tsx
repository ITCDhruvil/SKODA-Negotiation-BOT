"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EventStatDialog, type StatKind } from "@/components/events/EventStatDialog";
import type { EventView } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { STATUS_LABEL, STATUS_TONE, deltaLabel } from "@/lib/labels";
import { DirectionBadge, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { IconLink } from "@/components/ui/TableToolbar";

export function EventsTable({ events, empty, paginate = false }: { events: EventView[]; empty?: string; paginate?: boolean }) {
  const router = useRouter();
  const [stat, setStat] = useState<{ event: EventView; kind: StatKind } | null>(null);
  const lastKind = stat?.kind ?? "items";
  const opener = (e: EventView, kind: StatKind, text: React.ReactNode, label: string, className = "") => (
    <button
      type="button"
      title={label}
      aria-label={`${label}: ${e.id}`}
      onClick={(ev) => {
        ev.stopPropagation();
        setStat({ event: e, kind });
      }}
      className={`rounded-chip px-1.5 py-0.5 font-semibold underline decoration-dotted decoration-line underline-offset-4 hover:bg-brand-soft hover:text-brand hover:decoration-brand ${className}`}
    >
      {text}
    </button>
  );
  const columns: Column<EventView>[] = [
    {
      key: "id",
      header: "Event #",
      sort: (e) => e.id,
      cell: (e) => (
        <Link href={`/events/${e.id}`} className="whitespace-nowrap font-semibold text-brand hover:underline" onClick={(ev) => ev.stopPropagation()}>
          {e.id}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Title",
      sort: (e) => e.title.toLowerCase(),
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
      sort: (e) => e.category,
      hideBelowXl: true,
      cell: (e) => (
        <span className="block max-w-[180px] truncate text-muted" title={e.category}>
          {e.category}
        </span>
      ),
    },
    { key: "type", header: "Type", align: "center", className: "w-[1%]", sort: (e) => e.direction, cell: (e) => <DirectionBadge direction={e.direction} /> },
    { key: "items", header: "Items", align: "center", className: "w-[1%]", sort: (e) => e.item_count, hideOnMobile: true, cell: (e) => opener(e, "items", e.item_count, "Show items") },
    { key: "vendors", header: "Vendors", align: "center", className: "w-[1%]", sort: (e) => e.vendor_count, hideBelowXl: true, cell: (e) => opener(e, "vendors", e.vendor_count, "Show vendors") },
    {
      key: "value",
      header: "Value",
      align: "right",
      className: "w-[1%]",
      sort: (e) => (e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value),
      cell: (e) => opener(e, "value", money(e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value), "Show value breakdown", "whitespace-nowrap tabular-nums font-normal"),
    },
    {
      key: "delta",
      header: "Potential",
      align: "right",
      className: "w-[1%]",
      sort: (e) => (e.status === "closed" ? e.realised_delta : e.potential_delta),
      hideOnMobile: true,
      cell: (e) =>
        e.status === "closed" ? (
          opener(e, "potential", money(e.realised_delta), `${deltaLabel(e.direction)} achieved`, "whitespace-nowrap tabular-nums text-ok")
        ) : e.potential_delta > 0 ? (
          opener(e, "potential", money(e.potential_delta), "Show potential breakdown", "whitespace-nowrap tabular-nums text-ok")
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      className: "w-[1%]",
      sort: (e) => e.status,
      cell: (e) => (
        <div className="flex flex-col items-center gap-1">
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
      header: "",
      align: "right",
      className: "w-[1%]",
      cell: (e) => <IconLink href={`/events/${e.id}`} icon="eye" label="View event" />,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={events}
        rowKey={(e) => e.id}
        onRowClick={(e) => router.push(`/events/${e.id}`)}
        empty={empty ?? "No events match."}
        paginate={paginate}
        noun="events"
      />
      <EventStatDialog event={stat?.event ?? null} kind={lastKind} onClose={() => setStat(null)} />
    </>
  );
}
