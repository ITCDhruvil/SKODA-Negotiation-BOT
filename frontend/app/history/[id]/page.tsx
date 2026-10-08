"use client";

import Link from "next/link";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { useParams, useRouter } from "next/navigation";
import { DecisionPill, ResultCell, pastDealColumns } from "@/components/history/PastDeals";
import { Button, DirectionBadge, KpiCard, Panel, Pill } from "@/components/ui/basics";
import { TrendChart } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function PastDealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.pastDeal(id), [id]);
  if (loading && !data) return <Loading label="Loading the deal" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  const { deal: d, similar } = data;
  const verb = d.direction === "buy" ? "Paid" : "Received";
  const tone = d.decision === "gain" ? "ok" : d.decision === "loss" ? "red" : "info";

  const rows: [string, React.ReactNode][] = [
    ["Date", dateShort(d.date)],
    ["Type", <DirectionBadge key="t" direction={d.direction} />],
    ["Vendor", <Link key="v" href={`/vendors/${d.vendor_id}`} className="text-brand hover:underline">{d.vendor_name}</Link>],
    ["Vendor rating", data.vendor_rating.toFixed(1)],
    ["Quantity", `${num(d.qty)} ${d.unit}`],
    [`${verb} per ${d.unit}`, money(d.unit_price)],
    ["Value of the deal", money(d.value)],
    ["Negotiated", d.negotiated ? <Pill key="n" tone="info">Yes</Pill> : "No"],
  ];

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/vendors" className="hover:underline">Vendors</Link> /{" "}
            <Link href={`/vendors/${d.vendor_id}`} className="hover:underline">{d.vendor_name}</Link> /{" "}
            <Link href="/history" className="hover:underline">Past deals</Link> / {d.id}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.description}
            <DecisionPill p={d} />
          </span>
        }
        actions={
          <Button onClick={() => router.back()}>
            <Icon name="back" size={14} /> Back
          </Button>
        }
      />

      <KpiGrid className="mb-4">
        <KpiCard icon="coin" tone="amber" label="Value of the deal" value={money(d.value)} facts={[`${num(d.qty)} ${d.unit} at ${money(d.unit_price)}`]} />
        <KpiCard
          icon="trend"
          tone={tone === "red" ? "red" : "ok"}
          label="Profit / loss"
          value={d.result == null ? "—" : <ResultCell p={d} />}
          facts={d.benchmark ? [`against ${d.basis}`] : []}
        />
        <KpiCard icon="check" tone="info" label="Benchmark" value={d.benchmark ? money(d.benchmark) : "—"} facts={d.benchmark ? [`per ${d.unit}`] : []} />
        <KpiCard icon="chat" tone="brand" label="Similar deals" value={similar.length} facts={data.average_similar ? [`average ${money(data.average_similar)}`] : []} />
      </KpiGrid>

      <Notice tone={tone === "red" ? "red" : tone === "ok" ? "ok" : "info"}>{data.explanation}</Notice>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="The deal">
          <dl className="grid text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 last:border-0">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-semibold text-ink">{v}</dd>
              </div>
            ))}
            {d.negotiated && d.original_price != null && (
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-muted">Original quote</dt>
                <dd className="text-right font-semibold text-ink">{money(d.original_price)}</dd>
              </div>
            )}
          </dl>
        </Panel>
        <Panel title="Price against similar deals">
          {similar.length >= 2 ? (
            <TrendChart
              label="Price of this item over time"
              points={[d, ...similar].map((p) => ({ date: p.date, price: p.unit_price, negotiated: p.negotiated, label: p.vendor_name }))}
              refLines={d.benchmark ? [{ value: d.benchmark, label: "Benchmark", color: "var(--c3)" }] : []}
            />
          ) : (
            <p className="text-sm text-muted">Not enough similar deals to draw a trend.</p>
          )}
        </Panel>
      </div>

      {similar.length > 0 && (
        <div className="mt-4">
          <Panel title="Other deals for this item" flush>
            <DataTable columns={pastDealColumns({ showVendor: true })} rows={similar} rowKey={(p) => p.id} dense />
          </Panel>
        </div>
      )}
    </>
  );
}
