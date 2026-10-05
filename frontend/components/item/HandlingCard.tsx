import type { ItemView } from "@/lib/api";
import { moneyCompact } from "@/lib/format";

type Policy = ItemView["policy"];

const DOT: Record<Policy["band"], string> = { auto: "bg-ok", supervised: "bg-info", management: "bg-amber" };

/** Where the marker sits on the three-part scale: the bot's range, the range you check, and above. */
function position(p: Policy): number {
  const a = p.auto_limit_inr;
  const m = p.management_limit_inr;
  const v = p.value_inr;
  if (v < a) return v / a / 3;
  if (v <= m) return 1 / 3 + (v - a) / (m - a) / 3;
  return 2 / 3 + Math.min(1, (v - m) / m) / 3;
}

/** Who handles this deal, by its value: the bot, you with the bot's help, or higher management. Kept plain on purpose. */
export function HandlingCard({ policy, offers, compact = false, className = "" }: { policy: Policy; offers?: number; compact?: boolean; className?: string }) {
  const short = policy.band === "auto" && offers != null && offers < policy.min_offers;
  return (
    <section className={`rounded-card border border-line bg-panel p-4 shadow-card ${className}`} aria-label="Who handles this deal">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[policy.band]}`} aria-hidden />
        <h3 className="text-sm font-bold text-ink">{policy.headline}</h3>
        <span className="ml-auto text-xs tabular-nums text-muted">{moneyCompact(policy.value_inr)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-snug text-muted">{policy.message}</p>

      {!compact && (
        <div className="mt-4" aria-hidden>
          <div className="relative grid grid-cols-3 gap-1">
            {(["auto", "supervised", "management"] as const).map((b) => (
              <span key={b} className={`h-1.5 rounded-full ${b === policy.band ? DOT[b] : "bg-raise"}`} />
            ))}
            <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: `${position(policy) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Bot to {moneyCompact(policy.auto_limit_inr)} · You check to {moneyCompact(policy.management_limit_inr)} · Management above
          </p>
        </div>
      )}
      {!compact && short && (
        <p className="mt-2 text-xs font-semibold text-amber">
          The bot needs at least {policy.min_offers} offers for a deal this size; {offers} received.
        </p>
      )}
    </section>
  );
}
