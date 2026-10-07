"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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

  // The box updates at once; the server is asked once typing pauses.
  const [asked, setAsked] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setAsked(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, errorStatus, loading, reload } = useApi(
    () => api.events({ q: asked, from: range.from, to: range.to }),
    [asked, range.from, range.to],
  );
  // Keep showing the last list while a new search loads, so the search box is never torn down mid-typing.
  const last = useRef(data);
  if (data) last.current = data;
  const list = data ?? last.current;

  return (
    <>
      <RangeNotice />
      {loading && !list && <Loading label="Loading events" />}
      {error && <ErrorBox message={error} status={errorStatus} onRetry={reload} />}
      {list && <EventsPanel events={list} title="All events" q={q} onQ={setQ} paginate />}
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
