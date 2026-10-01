"use client";

import Link from "next/link";
import { useState } from "react";
import { DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { TableToolbar, IconLink } from "@/components/ui/TableToolbar";
import { DataTable } from "@/components/ui/DataTable";
import { pastDealColumns } from "@/components/history/PastDeals";
import { useRouter } from "next/navigation";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type HistoryRow } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel } from "@/lib/labels";

export default function HistoryPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState("");
  const [negotiated, setNegotiated] = useState("");
  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.history({ q, direction, negotiated: negotiated === "" ? undefined : negotiated === "yes", limit: 500 }),
    [q, direction, negotiated],
  );

  const columns = pastDealColumns({ showVendor: true });

  return (
    <>
      <Panel flush>
        <TableToolbar
          search={{ value: q, onChange: setQ, placeholder: "Search history" }}
          filters={[
            {
              key: "type",
              label: "Type",
              value: direction,
              onChange: setDirection,
              options: [{ value: "", label: "All" }, { value: "buy", label: "Purchase" }, { value: "sell", label: "Scrap" }],
            },
            {
              key: "negotiated",
              label: "Negotiated",
              value: negotiated,
              onChange: setNegotiated,
              options: [{ value: "", label: "All deals" }, { value: "yes", label: "Negotiated only" }, { value: "no", label: "Not negotiated" }],
            },
          ]}
          right={data ? <span>{data.length} deals</span> : null}
        />
        {loading && !data && <Loading label="Loading history" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} status={errorStatus} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={data} rowKey={(h) => h.id} onRowClick={(h) => router.push(`/history/${h.id}`)} empty="No deals match." dense paginate noun="deals" />}
      </Panel>
    </>
  );
}
