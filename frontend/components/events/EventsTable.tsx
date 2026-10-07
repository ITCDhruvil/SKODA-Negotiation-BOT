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
import { RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
import { api } from "@/lib/api";
import { inAis, openCaseInAis } from "@/lib/ais";

export function EventsTable({ events, empty, paginate = false }: { events: EventView[]; empty?: string; paginate?: boolean }) {
  const router = useRouter();
  const [stat, setStat] = useState<{ event: EventView; kind: StatKind } | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const menuItems = (e: EventView): RowMenuItem[] => {
    const list: RowMenuItem[] = [{ label: "View details", hint: "Items, quotes and negotiation", href: `/events/${e.id}`, icon: "eye" }];
    if (e.from_ais && inAis()) list.push({ label: "Open case in AIS", hint: "Go to the request in AIS", icon: "external", onSelect: () => openCaseInAis(e.id) });
    if (e.status === "closed") {
      list.push({ label: "Contract document", hint: "View the contract", href: `/events/${e.id}/contract`, icon: "events" });
      list.push({ label: "Download summary", hint: "The closed deal as a CSV file", icon: "download", onSelect: () => void window.open(api.exportUrl(e.id), "_blank") });
    }
    list.push({
      label: "Delete event",
      hint: "Remove it and its conversations",
      icon: "trash",
      danger: true,
      onSelect: async () => {
        setLeaving((prev) => new Set(prev).add(e.id));
        try {
          await Promise.all([api.deleteEvent(e.id), new Promise((r) => setTimeout(r, 320))]);
          setRemoved((prev) => new Set(prev).add(e.id));
        } catch (err) {
          setLeaving((prev) => {
            const n = new Set(prev);
            n.delete(e.id);
            return n;
          });
          throw err;
        }
      },
    });
    return list;
  };
  const menuSummary = (e: EventView) => {
    const potential = e.status === "closed" ? e.realised_delta : e.potential_delta;
    const stat = (k: string, v: React.ReactNode) => (
      <div key={k} className="min-w-0">
        <dt className="text-xs text-muted">{k}</dt>
        <dd className="text-sm font-semibold tabular-nums text-ink">{v}</dd>
      </div>
    );
    return (
      <dl className="grid gap-3">
        <div>
          <dt className="text-xs text-muted">Category</dt>
          <dd className="text-sm font-semibold text-ink">{e.category}</dd>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {stat("Items", e.item_count)}
          {stat("Vendors", e.vendor_count)}
          {stat(e.status === "closed" ? deltaLabel(e.direction) : "Potential", potential > 0 ? <span className="text-ok">{money(potential)}</span> : "—")}
        </div>
      </dl>
    );
  };
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
      className: "w-[60%] max-w-0",
      sort: (e) => e.title.toLowerCase(),
      cell: (e) => (
        <div>
          <div className="truncate font-semibold text-ink" title={e.title}>
            {e.title}
          </div>
          <div className="text-xs text-muted">{dateShort(e.created)}</div>
        </div>
      ),
    },
    { key: "type", header: "Type", align: "center", className: "w-[1%]", sort: (e) => e.direction, cell: (e) => <DirectionBadge direction={e.direction} /> },
    {
      key: "value",
      header: "Value",
      align: "right",
      className: "w-[1%]",
      sort: (e) => (e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value),
      cell: (e) => opener(e, "value", money(e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value), "Show value breakdown", "whitespace-nowrap tabular-nums font-normal"),
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
      cell: (e) => <RowMenu label={`Actions for ${e.id}`} items={menuItems(e)} header={menuSummary(e)} />,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={events.filter((e) => !removed.has(e.id))}
        rowClassName={(e) => (leaving.has(e.id) ? "row-leaving" : "")}
        rowKey={(e) => e.id}
        onRowClick={(e) => router.push(`/events/${e.id}`)}
        empty={empty ?? "No events match."}
        paginate={paginate}
        noScroll
        noun="events"
      />
      <EventStatDialog event={stat?.event ?? null} kind={lastKind} onClose={() => setStat(null)} />
    </>
  );
}
