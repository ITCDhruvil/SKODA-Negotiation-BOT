import type { TurnView } from "@/lib/api";
import { money } from "@/lib/format";

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-l rounded-bl-s border border-line bg-raise px-4 py-3 text-xs text-muted" role="status">
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
      {turns.map((t) => {
        const ours = t.speaker === "us";
        return (
          <div key={t.seq} className={`flex ${ours ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-l px-4 py-3 text-sm ${ours ? "rounded-br-s bg-brand-soft text-ink" : "rounded-bl-s border border-line bg-raise text-ink"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold">{ours ? "You" : vendorName}</span>
                {ours && t.author === "bot" && <span className="rounded-full bg-panel px-2 py-0.5">drafted for you</span>}
                {ours && t.author === "human" && <span className="rounded-full bg-panel px-2 py-0.5">written by you</span>}
                <span>{time(t.at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.price != null && <p className="mt-2 text-xs font-semibold tabular-nums text-muted">Offer {money(t.price)}{t.payment_code ? ` · ${t.payment_code}` : ""}</p>}
            </div>
          </div>
        );
      })}
      {typing && <TypingDots label={typing} />}
    </div>
  );
}
