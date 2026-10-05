import { Icon, type IconName } from "@/components/ui/Icon";
import type { ItemView } from "@/lib/api";
import { moneyCompact } from "@/lib/format";

type Policy = ItemView["policy"];

const LOOK: Record<Policy["band"], { icon: IconName; box: string; chip: string; text: string }> = {
  auto: { icon: "check", box: "border-ok bg-ok-soft", chip: "bg-ok text-on-brand", text: "text-ok" },
  supervised: { icon: "eye", box: "border-info bg-info-soft", chip: "bg-info text-on-brand", text: "text-info" },
  management: { icon: "vendors", box: "border-amber bg-amber-soft", chip: "bg-amber text-on-brand", text: "text-amber" },
};

/** Where the marker sits on the three-part scale: the bot's range, the range you check, and above. */
function position(p: Policy): number {
  const a = p.auto_limit_inr;
  const m = p.management_limit_inr;
  const v = p.value_inr;
  if (v < a) return (v / a) / 3;
  if (v <= m) return 1 / 3 + ((v - a) / (m - a)) / 3;
  return 2 / 3 + Math.min(1, (v - m) / m) / 3;
}

/** Who handles this deal, by its value: the bot, you with the bot's help, or higher management. */
export function HandlingCard({ policy, offers, compact = false, className = "" }: { policy: Policy; offers?: number; compact?: boolean; className?: string }) {
  const look = LOOK[policy.band];
  const enough = offers == null || offers >= policy.min_offers;
  return (
    <section className={`flex flex-col rounded-card border p-4 ${look.box} ${className}`} aria-label="Who handles this deal">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${look.chip}`}>
          <Icon name={look.icon} size={20} />
        </span>
        <div className="min-w-0">
          <p className={`text-base font-extrabold leading-tight ${look.text}`}>{policy.headline}</p>
          <p className="text-xs text-muted">Deal value {moneyCompact(policy.value_inr)}</p>
        </div>
      </div>
      <p className="mt-2.5 text-sm leading-snug text-ink">{policy.message}</p>

      {!compact && (
        <>
          <div className="mt-auto pt-4" aria-hidden>
            <div className="relative grid grid-cols-3 gap-1">
              {(["auto", "supervised", "management"] as const).map((b) => (
                <span key={b} className={`h-2 rounded-full ${b === policy.band ? LOOK[b].chip : "bg-line"}`} />
              ))}
              <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `${position(policy) * 100}%` }} />
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] leading-tight text-muted">
              <span>Bot<br />up to {moneyCompact(policy.auto_limit_inr)}</span>
              <span>You check<br />to {moneyCompact(policy.management_limit_inr)}</span>
              <span>Management<br />above EUR 50,000</span>
            </div>
          </div>
          {policy.band === "auto" && offers != null && (
            <p className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${enough ? "text-ok" : "text-amber"}`}>
              <Icon name="check" size={14} />
              {offers} {offers === 1 ? "offer" : "offers"} received · the bot needs at least {policy.min_offers} for a deal of this size
            </p>
          )}
        </>
      )}
    </section>
  );
}
