"use client";

import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DirectionBadge, Panel, Pill } from "@/components/ui/basics";
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  if (loading && !data) return <Loading label="Loading negotiations" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  const rows = (data ?? []).filter((r) => filter === "all" || r.status === filter);

  const columns: Column<SessionRow>[] = [
    {
      key: "item",
      header: "Item",
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
    { key: "dir", header: "Type", hideOnMobile: true, cell: (r) => <DirectionBadge direction={r.direction} /> },
    { key: "vendor", header: "Vendor", cell: (r) => r.vendor_name },
    { key: "mode", header: "Permission", hideOnMobile: true, cell: (r) => MODE_LABEL[r.mode] },
    { key: "round", header: "Rounds", align: "right", hideOnMobile: true, cell: (r) => r.round },
    { key: "orig", header: "Original", align: "right", hideOnMobile: true, cell: (r) => <span className="tabular-nums">{money(r.original_price)}</span> },
    {
      key: "now",
      header: "Latest / agreed",
      align: "right",
      cell: (r) => <span className="font-semibold tabular-nums">{money(r.agreed_price ?? r.vendor_offer)}</span>,
    },
    { key: "status", header: "Status", cell: (r) => <Pill tone={SESSION_TONE[r.status]}>{SESSION_LABEL[r.status]}</Pill> },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (r) => (
        <Link href={`/negotiate/${r.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
          {r.status === "active" ? "Open" : "View"}
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Negotiations"
        subtitle="Every conversation with a vendor, across all events. Start a new one from an item once its quotes are analyzed."
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f.key ? "border-brand bg-brand-soft text-brand" : "border-line bg-panel text-text"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Panel flush>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No negotiations here yet.</p>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        )}
      </Panel>
    </>
  );
}
