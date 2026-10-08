"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EventStatDialog, type StatKind } from "@/components/events/EventStatDialog";
import type { EventView } from "@/lib/api";
import { dateShort, money, pct } from "@/lib/format";
import { STATUS_LABEL, STATUS_TONE, deltaLabel } from "@/lib/labels";
import { DirectionBadge, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { MenuInfo, RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
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
    return (
      <MenuInfo
        rows={[
          ["Category", e.category],
          ["Items", e.item_count],
          ["Vendors", e.vendor_count],
          [e.status === "closed" ? deltaLabel(e.direction) : "Potential", potential > 0 ? <span className="text-ok">{money(potential)}</span> : "—"],
        ]}
      />
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
        <Link href={`/events/${e.id}`} className="group/id flex items-center gap-3" onClick={(ev) => ev.stopPropagation()}>
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${e.direction === "buy" ? "bg-info-soft text-info" : "bg-amber-soft text-amber"}`}
            title={e.direction === "buy" ? "Purchase event" : "Scrap sale"}
          >
            <Icon name={e.direction === "buy" ? "cart" : "tag"} size={18} />
          </span>
          <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink group-hover/id:text-brand group-hover/id:underline">{e.id}</span>
        </Link>
      ),
    },
    {
      key: "title",
      header: "Title",
      className: "w-[38%] min-w-[150px] max-w-0",
      sort: (e) => e.title.toLowerCase(),
      cell: (e) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink" title={e.title}>
            {e.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="cube" size={13} />
            {e.item_count} {e.item_count === 1 ? "item" : "items"}
            <span aria-hidden>•</span>
            {e.vendor_count} {e.vendor_count === 1 ? "vendor" : "vendors"}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      className: "w-[1%] min-w-[104px] whitespace-nowrap",
      hideBelowXl: true,
      sort: (e) => e.direction,
      cell: (e) => (
        <Pill tone={e.direction === "buy" ? "info" : "amber"}>
          <Icon name={e.direction === "buy" ? "cart" : "tag"} size={13} />
          {e.direction === "buy" ? "BUY" : "SELL"}
        </Pill>
      ),
    },
    {
      key: "value",
      header: "Value",
      className: "w-[1%] min-w-[150px] whitespace-nowrap",
      sort: (e) => (e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value),
      cell: (e) => {
        const closed = e.status === "closed";
        const delta = closed ? e.realised_delta : e.potential_delta;
        const basis = (closed ? e.original_value : e.reference_value) ?? 0;
        const share = basis > 0 ? delta / basis : 0;
        return (
          <div className="grid gap-0.5">
            <button
              type="button"
              title="Show value breakdown"
              aria-label={`Show value breakdown: ${e.id}`}
              onClick={(ev) => {
                ev.stopPropagation();
                setStat({ event: e, kind: "value" });
              }}
              className="w-fit rounded-chip text-left font-bold tabular-nums text-ink hover:text-brand focus-visible:text-brand"
            >
              {money(Math.round(closed ? (e.final_value ?? e.quoted_value) : e.quoted_value))}
            </button>
            {delta > 0 && share > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok" title={`${deltaLabel(e.direction)} ${closed ? "achieved" : "possible"}: ${money(Math.round(delta))}`}>
                <span aria-hidden className="text-[9px]">▲</span>
                {pct(share, 1)}
                <span className="font-normal text-muted">{closed ? "saved" : "possible"}</span>
              </span>
            ) : (
              <span className="text-xs text-muted">{closed ? "final" : "quoted"}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      className: "w-[1%] min-w-[130px] whitespace-nowrap",
      sort: (e) => e.status,
      cell: (e) => (
        <div className="flex flex-col items-start gap-1">
          <Pill tone={STATUS_TONE[e.status]}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {STATUS_LABEL[e.status]}
          </Pill>
          {!e.eligibility.eligible && (
            <span title={e.eligibility.reason}>
              <Pill tone="red">Not eligible</Pill>
            </span>
          )}
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      className: "w-[1%] min-w-[150px] whitespace-nowrap",
      hideBelowXl: true,
      sort: (e) => e.created,
      cell: (e) => (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Icon name="calendar" size={15} className="text-muted" />
          <div>
            <div className="text-[13px] text-ink">{dateShort(e.created)}</div>
            <div className="text-xs text-muted">{new Date(`${e.created}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" })}</div>
          </div>
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
        sortHints
        noun="events"
      />
      <EventStatDialog event={stat?.event ?? null} kind={lastKind} onClose={() => setStat(null)} />
    </>
  );
}
