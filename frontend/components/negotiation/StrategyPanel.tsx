import type { ReactNode } from "react";
import { Pill } from "@/components/ui/basics";
import { CollapsiblePanel } from "@/components/ui/CollapsiblePanel";
import type { Strategy } from "@/lib/api";
import { duration } from "@/lib/format";
import { MOOD_LABEL, MOOD_TONE, PHASE_LABEL, STANCE_LABEL, STANCE_TONE, TACTIC_LABEL, TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";

/** One small card: a heading with its status pills on the right and a short line underneath. */
function Block({ title, pills, children }: { title: string; pills?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-m border border-line2 bg-raise px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {pills && <div className="flex flex-wrap items-center justify-end gap-1.5">{pills}</div>}
      </div>
      <div className="text-sm leading-snug text-text">{children}</div>
    </section>
  );
}

/** The notes start with a label ("Firm: ..."); the pill already says it, so only the explanation is shown. */
const explanation = (note: string) => note.replace(/^[A-Za-z ]+: /, "");

/** Where the conversation stands: progress, how the vendor is behaving, what history says and what has been tried. */
export function StrategyPanel({ strategy }: { strategy: Strategy }) {
  const { round, max_rounds: max, phase, stance, stance_note: note, history, alternative } = strategy;
  const used = Array.from(new Set(strategy.tactics_used)).filter((t) => TACTIC_LABEL[t]);
  const share = Math.min(100, Math.round((round / max) * 100));
  return (
    <CollapsiblePanel title="Strategy" storageKey="strategy">
      <div className="grid gap-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-ink">{PHASE_LABEL[phase] ?? phase}</span>
            <span className="text-xs tabular-nums text-muted">Round {round} of {max}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raise" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={round} aria-label="Rounds used">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${share}%` }} />
          </div>
          {strategy.elapsed_minutes > 0 && (
            <p className="mt-1.5 text-xs text-muted">
              Time so far <b className="text-ink">{duration(strategy.elapsed_minutes)}</b>
            </p>
          )}
        </div>

        <Block
          title="Vendor right now"
          pills={
            <>
              <Pill tone={STANCE_TONE[stance]}>{STANCE_LABEL[stance]}</Pill>
              <Pill tone={MOOD_TONE[strategy.mood_label]}>{MOOD_LABEL[strategy.mood_label]}</Pill>
            </>
          }
        >
          {explanation(note)}
        </Block>

        {history.level !== "unknown" && (
          <Block title="From history" pills={<Pill tone={TOUGH_TONE[history.level]}>{TOUGH_LABEL[history.level]}</Pill>}>
            {explanation(history.note)}
          </Block>
        )}

        {alternative && (
          <Block title="Next-best quote">
            <span className="font-semibold text-ink">{alternative}</span>
          </Block>
        )}

        {used.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tried so far</h3>
            <div className="flex flex-wrap gap-1.5">
              {used.map((t) => (
                <span key={t} className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs font-semibold text-text">
                  {TACTIC_LABEL[t]}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsiblePanel>
  );
}
