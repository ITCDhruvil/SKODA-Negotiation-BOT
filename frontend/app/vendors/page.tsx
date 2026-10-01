"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel, Pill } from "@/components/ui/basics";
import { TableToolbar, IconLink } from "@/components/ui/TableToolbar";
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
      sort: (v) => v.name.toLowerCase(),
      cell: (v) => (
        <Link href={`/vendors/${v.id}`} className="font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
          {v.name}
        </Link>
      ),
    },
    { key: "sap", header: "SAP no.", sort: (v) => v.sap_no, hideOnMobile: true, cell: (v) => <span className="tabular-nums">{v.sap_no}</span> },
    {
      key: "type",
      header: "Type",
      sort: (v) => v.type,
      cell: (v) => <Pill tone={v.type === "supplier" ? "info" : "amber"}>{v.type === "supplier" ? "Supplier" : "Scrap buyer"}</Pill>,
    },
    { key: "rating", header: "Rating", align: "right", sort: (v) => v.rating, cell: (v) => v.rating.toFixed(1) },
    { key: "pay", header: "Payment pref.", sort: (v) => v.payment_pref, hideOnMobile: true, cell: (v) => v.payment_pref },
    { key: "bids", header: "Live quotes", align: "right", sort: (v) => v.live_bid_count, hideOnMobile: true, cell: (v) => v.live_bid_count },
    { key: "value", header: "Quoted value", align: "right", sort: (v) => v.quoted_value, cell: (v) => <span className="tabular-nums">{moneyCompact(v.quoted_value)}</span> },
    { key: "deals", header: "Past deals", align: "right", hideOnMobile: true, sort: (v) => v.past_deals, cell: (v) => v.past_deals },
    { key: "action", header: "", align: "right", cell: (v) => <IconLink href={`/vendors/${v.id}`} icon="eye" label="View vendor" /> },
  ];

  return (
    <>
      <Panel flush>
        <TableToolbar
          search={{ value: q, onChange: setQ, placeholder: "Search vendors" }}
          filters={[
            {
              key: "type",
              label: "Type",
              value: type,
              onChange: setType,
              options: [{ value: "", label: "All" }, { value: "supplier", label: "Suppliers" }, { value: "scrap_buyer", label: "Scrap buyers" }],
            },
          ]}
          right={data ? <span>{rows.length} vendors</span> : null}
        />
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
