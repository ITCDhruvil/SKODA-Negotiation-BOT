"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type VendorView } from "@/lib/api";
import { moneyCompact } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function VendorsPage() {
  const router = useRouter();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.vendors(), []);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");

  const rows = (data ?? []).filter(
    (v) => (!type || v.type === type) && (!q || `${v.name} ${v.sap_no} ${v.id}`.toLowerCase().includes(q.toLowerCase())),
  );

  const columns: Column<VendorView>[] = [
    {
      key: "name",
      header: "Vendor",
      cell: (v) => (
        <Link href={`/vendors/${v.id}`} className="font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
          {v.name}
        </Link>
      ),
    },
    { key: "sap", header: "SAP no.", hideOnMobile: true, cell: (v) => <span className="tabular-nums">{v.sap_no}</span> },
    {
      key: "type",
      header: "Type",
      cell: (v) => <Pill tone={v.type === "supplier" ? "info" : "amber"}>{v.type === "supplier" ? "Supplier" : "Scrap buyer"}</Pill>,
    },
    { key: "rating", header: "Rating", align: "right", cell: (v) => v.rating.toFixed(1) },
    { key: "pay", header: "Payment pref.", hideOnMobile: true, cell: (v) => v.payment_pref },
    { key: "bids", header: "Live quotes", align: "right", hideOnMobile: true, cell: (v) => v.live_bid_count },
    { key: "value", header: "Quoted value", align: "right", cell: (v) => <span className="tabular-nums">{moneyCompact(v.quoted_value)}</span> },
    { key: "deals", header: "Past deals", align: "right", hideOnMobile: true, cell: (v) => v.past_deals },
  ];

  return (
    <>
      <PageHeader title="Vendors" subtitle="Suppliers for buy carts and buyers for scrap lots." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SAP number…" aria-label="Search vendors" className={`${inputClass} max-w-sm`} />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Vendor type" className={`${inputClass} w-auto`}>
            <option value="">All vendors</option>
            <option value="supplier">Suppliers</option>
            <option value="scrap_buyer">Scrap buyers</option>
          </select>
          {data && <span className="text-xs text-muted">{rows.length} vendors</span>}
        </div>
        {loading && !data && <Loading label="Loading vendors" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} status={errorStatus} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={rows} rowKey={(v) => v.id} onRowClick={(v) => router.push(`/vendors/${v.id}`)} empty="No vendors match." />}
      </Panel>
    </>
  );
}
