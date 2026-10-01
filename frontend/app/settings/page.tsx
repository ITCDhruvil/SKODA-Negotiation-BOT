"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Panel, Pill } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";
import { API_BASE, api, type Direction } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useTheme } from "@/lib/providers";

export default function SettingsPage() {
  const health = useApi(() => api.health(), []);
  const { theme, toggle } = useTheme();
  // One status; a failed check wins over data from an earlier successful one.
  const status = health.error ? "unreachable" : health.data ? "healthy" : "checking";
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Appearance">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-ink">Dark mode</div>
              <div className="text-xs text-muted">Use a dark colour scheme across the app.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Dark mode"
              onClick={toggle}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${theme === "dark" ? "border-brand bg-brand" : "border-line bg-raise"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-panel shadow-card transition-all ${theme === "dark" ? "left-[26px]" : "left-0.5"}`}
              />
            </button>
          </div>
        </Panel>
        <Panel title="API status">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="font-semibold text-ink">{API_BASE}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Health</dt>
              <dd>
                {status === "checking" && <Pill tone="muted">Checking…</Pill>}
                {status === "healthy" && <Pill tone="ok">Healthy</Pill>}
                {status === "unreachable" && <Pill tone="red">Unreachable</Pill>}
              </dd>
            </div>
          </dl>
          {health.error && <p className="mt-3 text-sm text-red">{health.error}</p>}
          <Button className="mt-4" size="sm" onClick={() => void health.reload()}>
            Check again
          </Button>
        </Panel>
        <Panel title="Demo data">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void simulate("buy")}>Create purchase event</Button>
            <Button disabled={busy} onClick={() => void simulate("sell")}>Create scrap event</Button>
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
