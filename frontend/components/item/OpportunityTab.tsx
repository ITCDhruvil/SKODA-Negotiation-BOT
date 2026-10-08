import type { ItemDetail } from "@/lib/api";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/basics";
import { money, num } from "@/lib/format";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, deltaLabel, limitLabel, quoteLabel } from "@/lib/labels";

const TILE_TONE = {
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
  amber: "bg-amber-soft text-amber",
  ok: "bg-ok-soft text-ok",
} as const;

function Tile({ icon, tone, label, value, sub }: { icon: IconName; tone: keyof typeof TILE_TONE; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card border border-line2 bg-panel px-4 py-3.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${TILE_TONE[tone]}`}>
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-muted">{label}</div>
        <div className="truncate text-xl font-extrabold leading-tight tabular-nums text-ink">{value}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
    </div>
  );
}

/** Where the best quote, your target and your walk-away price sit on one line, so the room to negotiate is visible at a glance. */
function Ladder({ best, target, limit, buy }: { best: number; target: number; limit: number; buy: boolean }) {
  const values = [best, target, limit];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || hi || 1) * 0.15;
  const min = lo - pad;
  const span = hi + pad - min;
  const at = (v: number) => `${(((v - min) / span) * 100).toFixed(1)}%`;
  const marks = [
    { key: "best", v: best, label: `Best ${buy ? "quote" : "bid"}`, color: "var(--c2)" },
    { key: "target", v: target, label: "Target", color: "var(--c1)" },
    { key: "limit", v: limit, label: buy ? "Ceiling" : "Floor", color: "var(--red)" },
  ].sort((a, b) => a.v - b.v);
  const from = Math.min(best, target);
  const to = Math.max(best, target);
  return (
    <div className="rounded-card border border-line2 bg-raise px-5 pb-4 pt-9" role="img" aria-label={`Best ${best}, target ${target}, ${buy ? "ceiling" : "floor"} ${limit}`}>
      <div className="relative h-2 rounded-full bg-line">
        <span
          className="absolute inset-y-0 rounded-full"
          style={{ left: at(from), width: `${(((to - from) / span) * 100).toFixed(1)}%`, background: "color-mix(in srgb, var(--c1) 45%, var(--panel))" }}
        />
        {marks.map((m, i) => (
          <span key={m.key} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(m.v) }}>
            <span className="block h-4 w-4 rounded-full border-2 border-panel shadow-card" style={{ background: m.color }} />
            <span
              className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] leading-tight ${i % 2 === 0 ? "bottom-6" : "top-6"}`}
            >
              <span className="block font-semibold text-muted">{m.label}</span>
              <span className="block font-bold tabular-nums text-ink">{money(m.v)}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="mt-12 text-center text-xs text-muted">The shaded part is the room to negotiate between the best {buy ? "quote" : "bid"} and your target.</div>
    </div>
  );
}

/** The numbers behind a negotiation: what you can win and where your limits are. */
export function OpportunityTab({ detail, onStart }: { detail: ItemDetail; onStart: () => void }) {
  const { item, event } = detail;
  const d = event.direction;
  const buy = d === "buy";
  if (item.best_bid == null) {
    return <p className="text-sm text-muted">The opportunity appears once vendor quotes are in.</p>;
  }
  const best = item.best_bid;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={RECOMMENDATION_TONE[item.recommendation]}>{RECOMMENDATION_LABEL[item.recommendation]}</Pill>
        <p className="min-w-0 flex-1 text-sm text-text">
          {item.within_limit && item.recommendation === "accept" ? (
            <>
              The best {quoteLabel(d).toLowerCase()} of <b className="text-ink">{money(best)}</b> is already within your {limitLabel(d).toLowerCase()}. You can take it as it stands.
            </>
          ) : (
            <>
              The best {quoteLabel(d).toLowerCase()} is <b className="text-ink">{money(best)}</b> against your target of <b className="text-ink">{money(item.target)}</b>. Closing at target would give{" "}
              <b className="text-ok">
                {money(item.potential_delta)} {deltaLabel(d).toLowerCase()}
              </b>
              .
            </>
          )}
        </p>
        {item.state !== "closed" && (
          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition hover:brightness-110"
          >
            Plan the negotiation
            <Icon name="chevron" size={14} />
          </button>
        )}
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <Tile icon="coin" tone="info" label={`${item.state === "closed" ? "Original" : "Current"} best ${quoteLabel(d).toLowerCase()}`} value={money(best)} sub="per unit" />
        <Tile icon="trend" tone="ok" label="Target" value={money(item.target)} sub="what you are aiming for" />
        <Tile icon="info" tone="amber" label={limitLabel(d)} value={money(item.limit)} sub="your walk-away price" />
        <Tile icon="comparison" tone="brand" label="Gap per unit" value={money(item.gap)} sub="between best and target" />
        <Tile icon="cube" tone="info" label="Quantity" value={`${num(item.qty)} ${item.unit}`} />
        <Tile icon="check" tone="ok" label={`Potential ${deltaLabel(d).toLowerCase()}`} value={money(item.potential_delta)} sub="if it closes at target" />
      </div>

      <Ladder best={best} target={item.target} limit={item.limit} buy={buy} />
    </div>
  );
}
