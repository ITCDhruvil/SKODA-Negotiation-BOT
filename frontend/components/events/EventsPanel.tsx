"use client";

import { useMemo, useState } from "react";
import { CreateEventMenu } from "@/components/events/CreateEventMenu";
import { EventsTable } from "@/components/events/EventsTable";
import { Panel } from "@/components/ui/basics";
import { FilterMenu, SearchBox, type FilterDef } from "@/components/ui/TableToolbar";
import { Icon } from "@/components/ui/Icon";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import type { EventView } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/labels";

type Kind = "all" | "buy" | "sell";

const Count = ({ n }: { n: number }) => (
  <span className="rounded-full bg-line2 px-2 py-px text-[11px] font-bold tabular-nums text-text">{n}</span>
);

/**
 * The events table with tabs for purchase and scrap events, a search box, a filter menu and sortable
 * columns. Pass `q` and `onQ` when the search is done by the server; otherwise it filters locally.
 */
export function EventsPanel({
  events,
  title = "Events",
  q,
  onQ,
  limit,
  footer,
  actions,
  paginate = false,
}: {
  events: EventView[];
  title?: string;
  q?: string;
  onQ?: (q: string) => void;
  limit?: number;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  paginate?: boolean;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [localQ, setLocalQ] = useState("");
  const serverSearch = onQ !== undefined;
  const query = serverSearch ? (q ?? "") : localQ;

  const categories = useMemo(() => Array.from(new Set(events.map((e) => e.category))).sort(), [events]);
  const counts = useMemo(
    () => ({ all: events.length, buy: events.filter((e) => e.direction === "buy").length, sell: events.filter((e) => e.direction === "sell").length }),
    [events],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter(
      (e) =>
        (kind === "all" || e.direction === kind) &&
        (!status || e.status === status) &&
        (!category || e.category === category) &&
        (serverSearch || !needle || [e.id, e.title, e.category, e.requestor].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [events, kind, status, category, query, serverSearch]);
  const rows = limit ? shown.slice(0, limit) : shown;
  const filters: FilterDef[] = [
    {
      key: "status",
      label: "Status",
      value: status,
      onChange: setStatus,
      options: [{ value: "", label: "All" }, ...(["received", "in_progress", "closed"] as const).map((v) => ({ value: v, label: STATUS_LABEL[v] }))],
    },
    {
      key: "category",
      label: "Category",
      value: category,
      onChange: setCategory,
      options: [{ value: "", label: "All" }, ...categories.map((c) => ({ value: c, label: c.replace(/^\d+ - /, "") }))],
    },
  ];

  return (
    <Panel
      flush
      title={
        <span className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-info-soft text-info">
            <Icon name="calendar" size={22} />
          </span>
          <span className="grid">
            <span className="text-lg font-bold leading-tight text-ink">{title}</span>
            <span className="text-[13px] font-normal text-muted">Track and manage all events, purchases and scrap records.</span>
          </span>
        </span>
      }
      actions={actions ?? <CreateEventMenu />}
    >
      <div className="mt-4 flex flex-wrap items-center gap-3 px-4">
        <Tabs
          idPrefix="events"
          variant="chips"
          value={kind}
          onChange={setKind}
          tabs={[
            { key: "all", label: <><Icon name="list" size={16} />All ({counts.all})</> },
            { key: "buy", label: <><Icon name="cart" size={16} />Purchase events ({counts.buy})</> },
            { key: "sell", label: <><Icon name="tag" size={16} />Scrap events ({counts.sell})</> },
          ]}
        />
        <div className="ml-auto flex min-w-[260px] flex-1 items-center justify-end gap-2 sm:max-w-xl">
          <SearchBox value={query} onChange={serverSearch ? onQ! : setLocalQ} placeholder="Search by event name, ID or type..." />
          <FilterMenu filters={filters} />
        </div>
      </div>
      <div className="m-4 rounded-card border border-line2" role="tabpanel" id={panelId("events", kind)} aria-labelledby={tabId("events", kind)}>
        <div className="px-4 pt-3 text-right text-xs text-muted">{shown.length === events.length ? `${events.length} events` : `${shown.length} of ${events.length} events`}</div>
        <EventsTable events={rows} empty="No events match." paginate={paginate} />
        {footer}
      </div>
    </Panel>
  );
}
