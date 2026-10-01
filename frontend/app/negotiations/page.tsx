"use client";

import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { TableToolbar, IconLink } from "@/components/ui/TableToolbar";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type SessionRow } from "@/lib/api";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { MODE_LABEL, SESSION_LABEL, SESSION_TONE } from "@/lib/labels";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "In progress" },
  { key: "agreed", label: "Agreed" },
  { key: "handed_back", label: "Handed back" },
] as const;

export default function NegotiationsPage() {
  const { data, error, errorStatus, loading, reload } = useApi(() => api.negotiations(), []);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  if (loading && !data) return <Loading label="Loading negotiations" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  const rows = (data ?? []).filter(
    (r) => (filter === "all" || r.status === filter) && (!q || `${r.item_description} ${r.vendor_name} ${r.event_title}`.toLowerCase().includes(q.toLowerCase())),
  );

  const columns: Column<SessionRow>[] = [
    {
      key: "item",
      header: "Item",
      sort: (r) => r.item_description.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/items/${r.item_id}`} className="font-semibold text-brand hover:underline">
            {r.item_description}
          </Link>
          <div className="text-xs text-muted">
            <Link href={`/events/${r.event_id}`} className="hover:underline">{r.event_title}</Link>
          </div>
        </div>
      ),
    },
    { key: "dir", header: "Type", hideOnMobile: true, sort: (r) => r.direction, cell: (r) => <DirectionBadge direction={r.direction} /> },
    { key: "vendor", header: "Vendor", sort: (r) => r.vendor_name.toLowerCase(), cell: (r) => r.vendor_name },
    { key: "mode", header: "Permission", hideOnMobile: true, sort: (r) => r.mode, cell: (r) => MODE_LABEL[r.mode] },
    { key: "round", header: "Rounds", align: "right", hideOnMobile: true, sort: (r) => r.round, cell: (r) => r.round },
    { key: "orig", header: "Original", align: "right", hideOnMobile: true, sort: (r) => r.original_price, cell: (r) => <span className="tabular-nums">{money(r.original_price)}</span> },
    {
      key: "now",
      header: "Latest / agreed",
      align: "right",
      sort: (r) => r.agreed_price ?? r.vendor_offer,
      cell: (r) => <span className="font-semibold tabular-nums">{money(r.agreed_price ?? r.vendor_offer)}</span>,
    },
    { key: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Pill tone={SESSION_TONE[r.status]}>{SESSION_LABEL[r.status]}</Pill> },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (r) => <IconLink href={`/negotiate/${r.id}`} icon={r.status === "active" ? "chat" : "eye"} label={r.status === "active" ? "Open conversation" : "View conversation"} />,
    },
  ];

  return (
    <>
      <Panel flush>
        <TableToolbar
          search={{ value: q, onChange: setQ, placeholder: "Search negotiations" }}
          filters={[
            {
              key: "status",
              label: "Status",
              value: filter === "all" ? "" : filter,
              onChange: (v) => setFilter((v || "all") as typeof filter),
              options: FILTERS.map((f) => ({ value: f.key === "all" ? "" : f.key, label: f.label })),
            },
          ]}
          right={<span>{rows.length} negotiations</span>}
        />
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No negotiations here yet.</p>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} paginate noun="negotiations" />
        )}
      </Panel>
    </>
  );
}
