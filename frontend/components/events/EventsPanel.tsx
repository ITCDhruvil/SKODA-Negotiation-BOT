"use client";

import { useMemo, useState } from "react";
import { CreateEventMenu } from "@/components/events/CreateEventMenu";
import { EventsTable } from "@/components/events/EventsTable";
import { Panel } from "@/components/ui/basics";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import type { EventView } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/labels";

type Kind = "all" | "buy" | "sell";

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
}: {
  events: EventView[];
  title?: string;
  q?: string;
  onQ?: (q: string) => void;
  limit?: number;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
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

  return (
    <Panel title={title} flush actions={actions ?? <CreateEventMenu />}>
      <div className="-mt-1 px-4">
        <Tabs
          idPrefix="events"
          value={kind}
          onChange={setKind}
          tabs={[
            { key: "all", label: `All (${counts.all})` },
            { key: "buy", label: `Purchase events (${counts.buy})` },
            { key: "sell", label: `Scrap events (${counts.sell})` },
          ]}
        />
      </div>
      <div className="pt-3" role="tabpanel" id={panelId("events", kind)} aria-labelledby={tabId("events", kind)}>
        <TableToolbar
          search={{ value: query, onChange: serverSearch ? onQ! : setLocalQ, placeholder: "Search events" }}
          filters={[
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
          ]}
          right={<span>{shown.length} events</span>}
        />
        <EventsTable events={rows} empty="No events match." />
        {footer}
      </div>
    </Panel>
  );
}
