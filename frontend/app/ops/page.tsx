"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Panel, Pill } from "@/components/ui/basics";
import { Notice, PageHeader } from "@/components/ui/State";
import { API_BASE, api, type Direction } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export default function OpsPage() {
  const health = useApi(() => api.health(), []);
  const [message, setMessage] = useState<{ tone: "ok" | "red"; text: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<React.ReactNode>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await fn() });
    } catch (e) {
      setMessage({ tone: "red", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const simulate = (d: Direction) =>
    run(async () => {
      const res = await api.simulate(d);
      return (
        <>
          Created <Link href={`/events/${res.event.id}`} className="font-semibold underline">{res.event.id}</Link>.
        </>
      );
    });

  const reset = () => {
    if (!window.confirm("Reset all demo data back to the seed? Anything you changed will be lost.")) return;
    void run(async () => `Demo data reset (${(await api.reset()).events} events).`);
  };

  return (
    <>
      <PageHeader title="Ops" subtitle="Demo controls and system status." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="API status">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="font-semibold text-ink">{API_BASE}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Health</dt>
              <dd>
                {health.loading && !health.data && <Pill tone="muted">Checking…</Pill>}
                {health.data && <Pill tone="ok">Healthy</Pill>}
                {health.error && <Pill tone="red">Unreachable</Pill>}
              </dd>
            </div>
          </dl>
          {health.error && <p className="mt-3 text-sm text-red">{health.error}</p>}
          <Button className="mt-4" size="sm" onClick={() => void health.reload()}>
            Check again
          </Button>
        </Panel>
        <Panel title="Demo data" subtitle="Everything here is mock data for the proof of concept.">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void simulate("buy")}>Simulate BUY event</Button>
            <Button disabled={busy} onClick={() => void simulate("sell")}>Simulate SELL event</Button>
            <Button variant="danger" disabled={busy} onClick={reset}>Reset demo data</Button>
          </div>
          {message && (
            <div className="mt-4">
              <Notice tone={message.tone}>{message.text}</Notice>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
