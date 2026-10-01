"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EventsPanel } from "@/components/events/EventsPanel";
import { RangeNotice } from "@/components/ui/RangeNotice";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

function EventsInner() {
  const params = useSearchParams();
  const { range } = useRange();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.events({ q, from: range.from, to: range.to }),
    [q, range.from, range.to],
  );

  return (
    <>
      <PageHeader title="Events" />
      <RangeNotice />
      {loading && !data && <Loading label="Loading events" />}
      {error && <ErrorBox message={error} status={errorStatus} onRetry={reload} />}
      {data && <EventsPanel events={data} title="All events" q={q} onQ={setQ} />}
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
