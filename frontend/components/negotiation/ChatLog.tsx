import type { TurnView } from "@/lib/api";
import { duration, money } from "@/lib/format";
import { TACTIC_LABEL } from "@/lib/labels";

/** The time a message carries in the conversation: the first message time plus the conversation time elapsed. */
function clock(base: string, minutes: number): string {
  const d = new Date(new Date(base).getTime() + minutes * 60_000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-card rounded-bl-chip border border-line bg-raise px-4 py-3 text-xs text-muted" role="status">
        <span className="sr-only">{label}</span>
        <span aria-hidden className="flex items-center gap-1 motion-reduce:hidden">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
        <span aria-hidden className="hidden motion-reduce:inline">{label}</span>
      </div>
    </div>
  );
}

export function ChatLog({ turns, typing, vendorName }: { turns: TurnView[]; typing?: string | null; vendorName: string }) {
  return (
    <div role="log" aria-live="polite" aria-label="Conversation" className="grid gap-3">
      {turns.length === 0 && !typing && <p className="py-6 text-center text-sm text-muted">No messages yet.</p>}
      {turns.map((t, idx) => {
        const ours = t.speaker === "us";
        const gap = t.delay_minutes >= 60 && idx > 0;
        const day = Math.floor(t.elapsed_minutes / 1440) + 1;
        return (
          <div key={t.seq} className="grid gap-3">
            {gap && (
              <div className="flex items-center gap-3 text-xs font-semibold text-muted" role="separator" aria-label={`${ours ? "You wrote back" : "Replied"} after ${duration(t.delay_minutes)}`}>
                <span className="h-px flex-1 bg-line2" />
                <span className="rounded-full border border-line bg-panel px-3 py-1">
                  {ours ? "You wrote back after" : "Replied after"} {duration(t.delay_minutes)} · Day {day}
                </span>
                <span className="h-px flex-1 bg-line2" />
              </div>
            )}
          <div className={`flex ${ours ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-card px-4 py-3 text-sm ${ours ? "rounded-br-chip bg-brand-soft text-ink" : "rounded-bl-chip border border-line bg-raise text-ink"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold">{ours ? "You" : vendorName}</span>
                <span title={`${duration(t.elapsed_minutes)} into the conversation`}>{clock(turns[0].at, t.elapsed_minutes)}</span>
                {ours && t.tactic && TACTIC_LABEL[t.tactic] && (
                  <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-muted" title="What this message is doing (visible to you only)">
                    {TACTIC_LABEL[t.tactic]}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.price != null && <p className="mt-2 text-xs font-semibold tabular-nums text-muted">Offer {money(t.price)}{t.payment_code ? ` · ${t.payment_code}` : ""}</p>}
            </div>
          </div>
          </div>
        );
      })}
      {typing && <TypingDots label={typing} />}
    </div>
  );
}
