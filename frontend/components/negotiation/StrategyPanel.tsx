import { Panel, Pill } from "@/components/ui/basics";
import type { Strategy } from "@/lib/api";
import { duration } from "@/lib/format";
import { PHASE_LABEL, STANCE_LABEL, STANCE_TONE, TACTIC_LABEL, TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";

/** Where the conversation stands: round, phase, what the vendor has shown, history advice and the options. */
export function StrategyPanel({ strategy }: { strategy: Strategy }) {
  const { round, max_rounds: max, phase, stance, stance_note: note, history, alternative } = strategy;
  const used = Array.from(new Set(strategy.tactics_used)).filter((t) => TACTIC_LABEL[t]);
  const share = Math.min(100, Math.round((round / max) * 100));
  return (
    <Panel title="Strategy">
      <div className="grid gap-3 text-sm">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="font-semibold text-ink">{PHASE_LABEL[phase] ?? phase}</span>
            <span className="text-xs text-muted tabular-nums">Round {round} of {max}</span>
          </div>
          {strategy.elapsed_minutes > 0 && (
            <div className="mb-1 text-xs text-muted">
              Time so far: <b className="text-ink">{duration(strategy.elapsed_minutes)}</b>
            </div>
          )}
          <div className="h-1.5 overflow-hidden rounded-full bg-raise" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={round} aria-label="Rounds used">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${share}%` }} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Vendor right now</span>
            <Pill tone={STANCE_TONE[stance]}>{STANCE_LABEL[stance]}</Pill>
          </div>
          <p className="text-text">{note}</p>
        </div>

        {history.level !== "unknown" && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">From history</span>
              <Pill tone={TOUGH_TONE[history.level]}>{TOUGH_LABEL[history.level]}</Pill>
            </div>
            <p className="text-text">{history.note}</p>
          </div>
        )}

        {alternative && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Next-best quote</div>
            <p className="text-text">{alternative}</p>
          </div>
        )}

        {used.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Tactics used</div>
            <div className="flex flex-wrap gap-1.5">
              {used.map((t) => (
                <span key={t} className="rounded-full bg-raise px-2.5 py-0.5 text-xs font-semibold text-text">
                  {TACTIC_LABEL[t]}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
