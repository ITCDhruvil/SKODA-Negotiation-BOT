"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pill } from "@/components/ui/basics";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/State";
import { api, type ItemDetail, type SessionSummary, type SessionView } from "@/lib/api";
import { initials, money } from "@/lib/format";
import { SESSION_LABEL, SESSION_TONE, deltaLabel } from "@/lib/labels";

/**
 * After negotiating with several vendors: who ended up best, side by side. Choosing is only possible once every
 * conversation has finished, so the buyer never decides on half the picture.
 */
export function CompareResultsTab({
  detail,
  sessions,
  views,
  onChanged,
  onStart,
}: {
  detail: ItemDetail;
  sessions: SessionSummary[];
  views: Record<string, SessionView>;
  onChanged: () => Promise<void>;
  onStart: () => void;
}) {
  const router = useRouter();
  const { item, event } = detail;
  const buy = event.direction === "buy";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <Notice tone="info">
        Nothing to compare yet. Start a negotiation with one or more vendors, and their results appear here side by side.{" "}
        <button type="button" onClick={onStart} className="font-semibold underline">
          Start negotiation
        </button>
      </Notice>
    );
  }

  const rows = sessions
    .map((s) => {
      const v = views[s.id];
      const original = v?.original_price ?? item.best_bid ?? 0;
      const price = s.status === "agreed" ? (s.agreed_price ?? v?.vendor_offer ?? original) : (v?.vendor_offer ?? original);
      const perUnit = buy ? original - price : price - original;
      return { s, v, original, price, gain: perUnit * item.qty, perUnit };
    })
    .sort((a, b) => (buy ? a.price - b.price : b.price - a.price));

  const open = rows.filter((r) => r.s.status === "active" || r.s.status === "on_hold");
  const agreed = rows.filter((r) => r.s.status === "agreed");
  const finished = rows.length - open.length;
  const best = agreed[0]; // already ordered best first
  const allDone = open.length === 0;

  const choose = async (r: (typeof rows)[number]) => {
    setBusy(r.s.id);
    setError(null);
    try {
      await api.chooseDeal(item.id, r.s.id);
      await api.acceptDeal(item.id);
      router.push(`/events/${event.id}/approve`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
      await onChanged().catch(() => undefined);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-card border border-line2 bg-raise p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-ink">
            {allDone ? "All negotiations have finished" : `${finished} of ${rows.length} negotiations finished`}
          </span>
          {allDone && best && (
            <span className="text-ok">
              Best result: <b>{best.s.vendor_name}</b> at {money(best.price)}
            </span>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={finished} aria-label="Negotiations finished">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(finished / rows.length) * 100}%` }} />
        </div>
        {!allDone && (
          <p className="mt-2 text-[13px] text-muted">
            {open.length} still {open.length === 1 ? "running or on hold" : "running or on hold"}. Choosing opens when every conversation is over, so you compare the final results. The figures below are what each vendor offers so far.
            {open.some((r) => r.s.status === "on_hold") && " A vendor on hold can be resumed from its conversation, or handed back to leave it out."}
          </p>
        )}
        {allDone && agreed.length === 0 && <p className="mt-2 text-[13px] text-muted">Nobody agreed. You can start with another vendor.</p>}
      </div>

      <div className="overflow-x-auto rounded-card border border-line2">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line2 bg-raise text-left text-xs font-semibold text-muted">
              <th className="px-4 py-3">Vendor</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Rounds</th>
              <th className="px-3 py-3 text-right">Original quote</th>
              <th className="px-3 py-3 text-right">{agreed.length > 0 && allDone ? "Agreed price" : "Offer now"}</th>
              <th className="px-3 py-3 text-right">{deltaLabel(event.direction)}</th>
              <th className="px-4 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isBest = allDone && best && r.s.id === best.s.id;
              return (
                <tr key={r.s.id} className={`border-b border-line2 last:border-0 ${isBest ? "bg-ok-soft/50" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-soft text-xs font-bold text-info" aria-hidden>
                        {initials(r.s.vendor_name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink">{r.s.vendor_name}</div>
                        {isBest && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok">
                            <Icon name="check" size={12} />
                            Best result
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Pill tone={SESSION_TONE[r.s.status]}>{SESSION_LABEL[r.s.status]}</Pill>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.s.round}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{money(r.original)}</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-ink">{money(r.price)}</td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${r.gain > 0 ? "text-ok" : "text-muted"}`}>{r.gain > 0 ? money(Math.round(r.gain)) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {r.s.status === "agreed" ? (
                      <button
                        type="button"
                        disabled={!allDone || busy !== null}
                        title={allDone ? undefined : "Available when every negotiation has finished"}
                        onClick={() => choose(r)}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                          isBest ? "bg-brand text-on-brand hover:brightness-110" : "border border-line text-ink hover:border-brand hover:text-brand"
                        }`}
                      >
                        {busy === r.s.id ? "Working…" : "Go ahead with this vendor"}
                      </button>
                    ) : (
                      <Link href={`/negotiate/${r.s.id}`} className="text-xs font-semibold text-brand hover:underline">
                        Open
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {allDone && agreed.length > 0 && <p className="text-xs text-muted">Going ahead sends the chosen result for review and closes the other conversations.</p>}
    </div>
  );
}
