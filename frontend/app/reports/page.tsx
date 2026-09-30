"use client";

import Link from "next/link";
import { EventsTable } from "@/components/events/EventsTable";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard, Panel } from "@/components/ui/basics";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type Dashboard } from "@/lib/api";
import { moneyCompact, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

type Cat = Dashboard["value_by_category"][number];

export default function ReportsPage() {
  const { range } = useRange();
  const { data, error, loading, reload } = useApi(() => api.dashboard(range), [range.from, range.to]);

  const columns: Column<Cat>[] = [
    { key: "cat", header: "Category", cell: (c) => c.category },
    { key: "value", header: "Quoted value", align: "right", cell: (c) => <span className="tabular-nums">{moneyCompact(c.value)}</span> },
    { key: "share", header: "Share", align: "right", cell: (c) => pct(c.share) },
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle="What negotiation has delivered so far, for the selected dates." />
      {loading && !data && <Loading label="Loading reports" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon="coin" tone="ok" label="Savings generated" value={moneyCompact(data.delta_generated.savings)} sub="Buy events" />
            <KpiCard icon="trend" tone="ok" label="Uplift generated" value={moneyCompact(data.delta_generated.uplift)} sub="Scrap sales" />
            <KpiCard icon="check" tone="brand" label="Completed negotiations" value={data.kpis.completed_negotiations} />
            <KpiCard icon="chat" tone="amber" label="Still on the table" value={moneyCompact(data.kpis.potential_total)} sub="Potential across open items" />
          </div>
          <Panel title="Closed events" subtitle="Events finished in this period." flush>
            <EventsTable events={data.events.filter((e) => e.status === "closed")} empty="No closed events in this period." />
          </Panel>
          <Panel title="Value by category" flush>
            <DataTable columns={columns} rows={data.value_by_category} rowKey={(c) => c.category_key} dense />
          </Panel>
          <p className="text-xs text-muted">
            Prices and scrap rates are illustrative POC values. See the <Link href="/history" className="text-brand underline">history log</Link> for the deals behind the benchmarks.
          </p>
        </div>
      )}
    </>
  );
}
