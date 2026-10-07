"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { Invitee } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";

type T = Invitee["toughness"];

const RULE: Record<T["level"], string> = {
  hard: "Hard to crack",
  firm: "Firm",
  flexible: "Flexible",
  unknown: "Not rated yet",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-m border border-line2 bg-raise px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/** The rating pill with an information button: opens the evidence behind "hard to crack", "firm" or "flexible". */
export function ToughnessBadge({ vendorName, toughness: t, showUnknown = false }: { vendorName: string; toughness: T; showUnknown?: boolean }) {
  const [open, setOpen] = useState(false);
  if (t.level === "unknown" && !showUnknown) return null;
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
  return (
    <>
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Pill tone={TOUGH_TONE[t.level]}>{TOUGH_LABEL[t.level]}</Pill>
        <button
          type="button"
          aria-label={`Why ${vendorName} is rated ${RULE[t.level].toLowerCase()}`}
          title="Why this rating?"
          onClick={() => setOpen(true)}
          className="grid h-5 w-5 place-items-center rounded-full border border-line text-muted transition hover:border-brand hover:text-brand focus-visible:border-brand"
        >
          <Icon name="info" size={12} />
        </button>
      </span>
      <Dialog open={open} title={`${vendorName}: ${RULE[t.level].toLowerCase()}`} size="lg" onClose={() => setOpen(false)}>
        <div className="grid gap-4 text-sm" onClick={(e) => e.stopPropagation()}>
          <p className="text-text">{t.note}</p>

          {t.negotiated_deals > 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Stat label="Past deals negotiated" value={`${t.negotiated_deals} of ${t.total_deals}`} hint="the rest were taken as quoted" />
              <Stat label="Price moved on average" value={pct(t.average_concession_pct)} hint="of the original quote" />
              <Stat label="Rounds to settle" value={t.average_rounds != null ? t.average_rounds.toFixed(1) : "—"} hint="average per negotiation" />
              <Stat label="Time to settle" value={t.average_minutes != null ? `${t.average_minutes} min` : "—"} hint="average per negotiation" />
              <Stat label="Replies in" value={t.average_reply_minutes != null ? `${t.average_reply_minutes} min` : "—"} hint="average per message" />
              <Stat label="Barely moved (under 2%)" value={`${t.held_firm_deals} of ${t.negotiated_deals}`} hint={`best ${pct(t.best_concession_pct)}, worst ${pct(t.worst_concession_pct)}`} />
            </div>
          )}

          <div className="rounded-m border border-line2 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">How the rating is decided</p>
            <ul className="grid gap-1 text-text">
              <li>
                <b>Hard to crack:</b> the price moved less than {t.hard_below_pct}% on average.
              </li>
              <li>
                <b>Firm:</b> between {t.hard_below_pct}% and {t.firm_below_pct}%.
              </li>
              <li>
                <b>Flexible:</b> {t.firm_below_pct}% or more.
              </li>
              <li className="text-muted">Needs at least {t.min_deals} negotiated deals with this vendor. Deals taken as quoted do not count.</li>
            </ul>
          </div>

          {t.recent.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Recent negotiated deals</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line2 text-left text-xs font-semibold text-muted">
                      <th className="py-2 pr-3">Item</th>
                      <th className="px-3 py-2">Closed</th>
                      <th className="px-3 py-2 text-right">Quote</th>
                      <th className="px-3 py-2 text-right">Final</th>
                      <th className="px-3 py-2 text-right">Moved</th>
                      <th className="px-3 py-2 text-right">Rounds</th>
                      <th className="py-2 pl-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.recent.map((d, i) => (
                      <tr key={i} className="border-b border-line2 last:border-0">
                        <td className="max-w-[200px] truncate py-2 pr-3 text-ink" title={d.description}>{d.description}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">{dateShort(d.closed)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(d.original_price)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(d.final_price)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${d.moved_pct < 2.5 ? "text-red" : d.moved_pct < 4.5 ? "text-amber" : "text-ok"}`}>{d.moved_pct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.rounds}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{d.minutes} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">Prices are per unit. Rounds and time are worked out from each deal, not logged by the bot.</p>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
