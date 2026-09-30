"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EventsTable } from "@/components/events/EventsTable";
import { inputClass, Panel } from "@/components/ui/basics";
import { RangeNotice } from "@/components/ui/RangeNotice";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";
import { useEffect, useState } from "react";

function EventsInner() {
  const params = useSearchParams();
  const { range } = useRange();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.events({ q, direction, status, from: range.from, to: range.to }),
    [q, direction, status, range.from, range.to],
  );

  return (
    <>
      <PageHeader title="Events" subtitle="Every buy cart and scrap lot, newest first." />
      <RangeNotice />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search id, title, category, requestor, cart no, item…"
            aria-label="Search events"
            className={`${inputClass} max-w-sm`}
          />
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">All types</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">All statuses</option>
            <option value="received">Received</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} events</span>}
        </div>
        {loading && !data && <Loading label="Loading events" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} status={errorStatus} onRetry={reload} />
          </div>
        )}
        {data && <EventsTable events={data} empty="No events match these filters." />}
      </Panel>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<Loading label="Loading events" />}>
      <EventsInner />
    </Suspense>
  );
}
