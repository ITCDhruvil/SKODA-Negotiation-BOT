"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ToughnessBadge } from "@/components/negotiation/ToughnessBadge";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import { inputClass, Pill } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";
import { api, type ItemDetail, type Mode, type Objective, type SessionSummary } from "@/lib/api";
import { initials, money } from "@/lib/format";
import { MODE_HINT, MODE_LABEL, SESSION_LABEL, SESSION_TONE, limitLabel, objectiveOptions, quoteLabel } from "@/lib/labels";

const EDITABLE = ["draft", "points_reviewed", "analyzed", "handed_back"];
const MODES: Mode[] = ["auto", "approve", "manual"];
const MODE_ICON = { auto: "bulb", approve: "check", manual: "chat" } as const;

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line2 bg-panel p-4 sm:p-5" aria-label={title}>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-on-brand">{n}</span>
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-tight text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** The guided way to begin: pick the vendors, set what you are aiming for, choose how messages go out, then start. */
export function StartNegotiationTab({
  detail,
  sessions,
  onChanged,
  onStarted,
}: {
  detail: ItemDetail;
  sessions: SessionSummary[];
  onChanged: () => Promise<void>;
  onStarted: () => void;
}) {
  const router = useRouter();
  const { item, event } = detail;
  const policy = item.policy;
  const buy = event.direction === "buy";
  const lim = limitLabel(event.direction);

  // ---- vendors -------------------------------------------------------------------------
  const rows = useMemo(() => {
    const byId = new Map(detail.invitees.map((v) => [v.vendor_id, v]));
    return detail.comparison.rows.map((r) => ({ q: r, v: byId.get(r.vendor_id) }));
  }, [detail.comparison.rows, detail.invitees]);
  const sessionOf = (vendorId: string) => [...sessions].reverse().find((s) => s.vendor_id === vendorId);
  const blocked = (vendorId: string) => {
    const s = sessionOf(vendorId);
    return s && (s.status === "active" || s.status === "on_hold" || s.status === "agreed") ? s : null;
  };
  const running = sessions.filter((s) => s.status === "active");
  const firstFree = rows.find((r) => !blocked(r.q.vendor_id))?.q.vendor_id;
  const [plan, setPlan] = useState<"one" | "many">("one");
  const [picked, setPicked] = useState<string[]>(firstFree ? [firstFree] : []);
  const [holdRunning, setHoldRunning] = useState(true);
  useEffect(() => {
    setPicked((p) => {
      const free = p.filter((id) => !blocked(id));
      return free.length === 0 && firstFree ? [firstFree] : free;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length, sessions.map((s) => s.status).join()]);

  const toggle = (id: string) => {
    if (blocked(id)) return;
    if (plan === "one") return setPicked([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const switchPlan = (p: "one" | "many") => {
    setPlan(p);
    if (p === "one") setPicked((cur) => cur.slice(0, 1));
  };

  // ---- points ----------------------------------------------------------------------------
  const editable = EDITABLE.includes(item.state);
  const [target, setTarget] = useState(String(item.target));
  const [limit, setLimit] = useState(String(item.limit));
  const [objective, setObjective] = useState<Objective | "">(item.objective ?? "");
  useEffect(() => {
    setTarget(String(item.target));
    setLimit(String(item.limit));
    setObjective(item.objective ?? "");
  }, [item.id, item.target, item.limit, item.objective]);
  const t = Number(target);
  const l = Number(limit);
  const pointsOk = t > 0 && l > 0 && (buy ? l >= t : l <= t);
  const changed = t !== item.target || l !== item.limit || (objective || null) !== (item.objective ?? null);
  const best = item.best_bid ?? 0;
  const winAtTarget = Math.max(0, buy ? best - t : t - best) * item.qty;

  // ---- handling --------------------------------------------------------------------------
  const [mode, setMode] = useState<Mode>(policy.default_mode);
  useEffect(() => {
    if (mode === "auto" && !policy.auto_allowed) setMode("approve");
  }, [mode, policy.auto_allowed]);

  // ---- start -----------------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (policy.band === "management") {
    return (
      <Notice tone="amber">
        <b>Handled by higher management.</b> {policy.message}
      </Notice>
    );
  }
  if (["closed", "awaiting_approval", "result_pending"].includes(item.state)) {
    return <Notice tone="info">This item already has a result, so there is nothing to start.</Notice>;
  }
  if (!["analyzed", "negotiating", "handed_back"].includes(item.state)) {
    return <Notice tone="info">A negotiation can start once the quotes are analysed. Finish the steps above first.</Notice>;
  }
  if (!event.eligibility.eligible) {
    return <Notice tone="amber">Not eligible for negotiation: {event.eligibility.reason}.</Notice>;
  }

  const ready = picked.length > 0 && (pointsOk || !editable) && !busy;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editable && changed) await api.setPoints(item.id, { target: t, limit: l, objective: objective || null });
      const started: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        const s = await api.startNegotiation(item.id, { vendor_id: picked[i], mode, hold_active: i === 0 && holdRunning && running.length > 0 });
        started.push(s.id);
      }
      await onChanged();
      if (started.length === 1) router.push(`/negotiate/${started[0]}`);
      else onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await onChanged().catch(() => undefined);
      setBusy(false);
    }
  };

  const names = picked.map((id) => rows.find((r) => r.q.vendor_id === id)?.q.vendor_name ?? id);

  return (
    <div className="grid gap-4">
      {running.length > 0 && (
        <Notice tone="info">
          {running.length === 1 ? `A negotiation with ${running[0].vendor_name} is running.` : `${running.length} negotiations are running.`}{" "}
          <Link href={`/negotiate/${running[0].id}`} className="font-semibold underline">
            Open it
          </Link>{" "}
          or add more vendors below.
        </Notice>
      )}

      <Step n={1} title="Who do you want to negotiate with?" hint="Pick one vendor, or several to run at the same time. Vendors that quoted are listed with their price.">
        <div className="mb-3 inline-flex rounded-full bg-raise p-1" role="radiogroup" aria-label="One vendor or several">
          {(
            [
              ["one", "One vendor"],
              ["many", "Several at once"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={plan === k}
              onClick={() => switchPlan(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${plan === k ? "bg-panel text-ink shadow-card" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <ul className="grid gap-2">
          {rows.map(({ q, v }, idx) => {
            const b = blocked(q.vendor_id);
            const prior = !b ? sessionOf(q.vendor_id) : null;
            const on = picked.includes(q.vendor_id);
            return (
              <li key={q.vendor_id}>
                <div
                  role={plan === "one" ? "radio" : "checkbox"}
                  aria-checked={on}
                  aria-disabled={!!b}
                  tabIndex={b ? -1 : 0}
                  onClick={() => toggle(q.vendor_id)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggle(q.vendor_id);
                    }
                  }}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border px-3.5 py-3 transition ${
                    b ? "cursor-not-allowed border-line2 bg-raise opacity-80" : on ? "cursor-pointer border-brand bg-brand-soft" : "cursor-pointer border-line2 bg-panel hover:border-brand"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center border-2 ${plan === "one" ? "rounded-full" : "rounded-md"} ${on ? "border-brand bg-brand text-on-brand" : "border-line bg-panel"}`}
                    aria-hidden
                  >
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-soft text-xs font-bold text-info" aria-hidden>
                    {initials(q.vendor_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-ink">{q.vendor_name}</span>
                      {idx === 0 && <Pill tone="ok">Best {quoteLabel(event.direction).toLowerCase()}</Pill>}
                      {v && <ToughnessBadge vendorName={q.vendor_name} toughness={v.toughness} />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Rating {q.vendor_rating.toFixed(1)} · {q.payment_code}
                      {prior && prior.status === "handed_back" ? " · tried before, no deal" : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-bold tabular-nums text-ink">{money(q.unit_price)}</span>
                    <span className="block text-xs text-muted">per unit</span>
                  </span>
                  {b && (
                    <span className="flex items-center gap-2">
                      <Pill tone={SESSION_TONE[b.status]}>{SESSION_LABEL[b.status]}</Pill>
                      <Link href={`/negotiate/${b.id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-semibold text-brand hover:underline">
                        {b.status === "on_hold" ? "Resume" : "Open"}
                      </Link>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {running.length > 0 && (
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-card bg-raise p-3 text-sm">
            <input type="checkbox" checked={holdRunning} onChange={(e) => setHoldRunning(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
            <span>
              <b className="text-ink">Put the running negotiation on hold</b>
              <span className="block text-muted">
                It stays exactly as it is and can be resumed any time, until the other vendors finalise or you decide. Untick to let it keep running alongside.
              </span>
            </span>
          </label>
        )}
      </Step>

      <Step n={2} title="What are you aiming for?" hint="Your negotiation points. The vendor never sees the walk-away price.">
        {!editable && <Notice tone="info">Points are locked while a negotiation is running, so every conversation works to the same limits.</Notice>}
        <div className={`grid gap-3 sm:grid-cols-3 ${editable ? "" : "mt-3"}`}>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-ink">Target price</span>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!editable || busy} className={inputClass} aria-invalid={!(t > 0)} />
            <span className="text-xs text-muted">Per unit. What you would be happy with.</span>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold text-ink">{lim} (walk-away)</span>
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!editable || busy} className={inputClass} aria-invalid={!(l > 0)} />
            <span className="text-xs text-muted">{buy ? "Never pay more than this." : "Never sell for less than this."}</span>
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="font-semibold text-ink">Objective</span>
            <Select<Objective | ""> value={objective} onChange={setObjective} disabled={!editable || busy} ariaLabel="Negotiation objective" options={[{ value: "", label: "No preference" }, ...objectiveOptions(event.direction)]} />
            <span className="text-xs text-muted">What matters most besides the price.</span>
          </div>
        </div>
        {editable && !pointsOk && (
          <p className="mt-3 text-sm text-red" role="alert">
            {!(t > 0 && l > 0) ? "Enter a price above zero for both." : buy ? "The ceiling must be at or above the target." : "The floor must be at or below the target."}
          </p>
        )}
        {pointsOk && winAtTarget > 0 && (
          <p className="mt-3 rounded-card bg-ok-soft px-3 py-2 text-sm text-ok">
            Closing at the target is worth about <b>{money(Math.round(winAtTarget))}</b> against the best {quoteLabel(event.direction).toLowerCase()} of {money(best)}.
          </p>
        )}
      </Step>

      <Step n={3} title="How should the messages go out?" hint="You can stop and take over at any time.">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who sends the messages">
          {MODES.map((m) => {
            const off = m === "auto" && !policy.auto_allowed;
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off || busy}
                onClick={() => setMode(m)}
                className={`flex flex-col items-start gap-2 rounded-card border p-3.5 text-left transition ${
                  off ? "cursor-not-allowed border-line2 bg-raise opacity-60" : on ? "border-brand bg-brand-soft" : "border-line2 bg-panel hover:border-brand"
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-full ${on ? "bg-brand text-on-brand" : "bg-raise text-muted"}`}>
                    <Icon name={MODE_ICON[m]} size={17} />
                  </span>
                  <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${on ? "border-brand bg-brand text-on-brand" : "border-line"}`} aria-hidden>
                    {on && <Icon name="check" size={12} />}
                  </span>
                </span>
                <span className="font-semibold text-ink">{MODE_LABEL[m]}</span>
                <span className="text-xs leading-snug text-muted">{off ? "Not available for a deal of this size. A person stays in the loop." : MODE_HINT[m]}</span>
              </button>
            );
          })}
        </div>
      </Step>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel p-3.5 shadow-pop">
        <div className="min-w-0 flex-1 text-sm">
          {picked.length === 0 ? (
            <span className="text-muted">Choose at least one vendor to start.</span>
          ) : (
            <span className="text-text">
              <b className="text-ink">{picked.length === 1 ? names[0] : `${picked.length} vendors`}</b>
              {picked.length > 1 && <span className="text-muted"> ({names.join(", ")})</span>} · target {money(t)} · {MODE_LABEL[mode].toLowerCase()}
              {running.length > 0 && holdRunning && <span className="text-muted"> · running one goes on hold</span>}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={start}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-on-brand shadow-card transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="send" size={16} className="rotate-90" />
          {busy ? "Starting…" : picked.length > 1 ? `Start ${picked.length} negotiations` : "Start negotiation"}
        </button>
      </div>
    </div>
  );
}
