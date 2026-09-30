import type { ItemDetail } from "@/lib/api";
import { money, num } from "@/lib/format";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, deltaLabel, limitLabel, quoteLabel } from "@/lib/labels";
import { Button, Delta, Panel, Pill } from "@/components/ui/basics";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line2 py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

export function OpportunityPanel({ detail }: { detail: ItemDetail }) {
  const { item, event } = detail;
  const d = event.direction;
  if (item.best_bid == null) {
    return (
      <Panel title="Negotiation opportunity">
        <p className="text-sm text-muted">Opportunity appears once vendor quotes are in.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Negotiation opportunity"
      actions={<Pill tone={RECOMMENDATION_TONE[item.recommendation]}>{RECOMMENDATION_LABEL[item.recommendation]}</Pill>}
    >
      <dl>
        <Row label={`${item.state === "closed" ? "Original" : "Current"} best ${quoteLabel(d).toLowerCase()}`}>{money(item.best_bid)}</Row>
        <Row label="Target">{money(item.target)}</Row>
        <Row label={limitLabel(d)}>{money(item.limit)}</Row>
        <Row label="Gap per unit">{money(item.gap)}</Row>
        <Row label="Quantity">
          {num(item.qty)} {item.unit}
        </Row>
        <Row label={`Potential ${deltaLabel(d).toLowerCase()}`}>
          <Delta value={item.potential_delta} direction={d} />
        </Row>
      </dl>
      {item.within_limit && item.recommendation === "accept" && (
        <p className="mt-3 text-sm text-ok">Best {quoteLabel(d).toLowerCase()} is already within your {limitLabel(d).toLowerCase()}.</p>
      )}
      <div className="mt-4">
        <Button variant="primary" disabled className="w-full" aria-describedby="start-negotiation-note" title="The negotiation workspace arrives in the next release">
          Start negotiation
        </Button>
        <p id="start-negotiation-note" className="mt-2 text-xs text-muted">
          The buyer always starts a negotiation. The workspace opens in the next release; until then you can prepare points and compare quotes.
        </p>
      </div>
    </Panel>
  );
}
