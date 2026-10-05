import { Icon } from "@/components/ui/Icon";
import type { TurnView } from "@/lib/api";
import { duration, initials, money } from "@/lib/format";
import { TACTIC_LABEL } from "@/lib/labels";

/** The time a message carries in the conversation: the first message time plus the conversation time elapsed. */
function stamp(base: string, minutes: number): Date | null {
  const d = new Date(new Date(base).getTime() + minutes * 60_000);
  return Number.isNaN(d.getTime()) ? null : d;
}
const clockTime = (d: Date | null) => (d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase() : "");
const weekday = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { weekday: "long" }) : "");

const AVATAR_COLOURS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c5)", "var(--c6)"];
function colourFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

/** A round badge with the initials of a name, in a colour that stays the same for that name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const c = colourFor(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: size * 0.38, color: c, background: `color-mix(in srgb, ${c} 16%, var(--panel))`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}
    >
      {initials(name)}
    </span>
  );
}

/** Top of the chat: who you are talking to and whether they are typing, like a messaging app. */
export function ChatHeader({ name, subtitle, typing, live, actions }: { name: string; subtitle: string; typing: boolean; live: boolean; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} size={40} />
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-bold leading-tight text-ink">{name}</h2>
        <p className={`flex items-center gap-1.5 truncate text-xs ${typing ? "font-semibold text-ok" : "text-muted"}`}>
          {live && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${typing ? "bg-ok" : "bg-ok"}`} aria-hidden />}
          {typing ? "typing…" : subtitle}
        </p>
      </div>
      {actions && <div className="ml-auto shrink-0">{actions}</div>}
    </div>
  );
}

const INSIGHT_LABEL: Record<string, string> = {
  position: "Where they stand",
  terms: "Terms compared",
  alternative: "Other quotes",
  history: "From history",
  crawl: "Small steps",
  mood: "Mood",
  checkpoint: "Within reach",
  left: "Vendor left",
};
const INSIGHT_TONE: Record<string, string> = {
  info: "border-info bg-info-soft text-info",
  good: "border-ok bg-ok-soft text-ok",
  warn: "border-amber bg-amber-soft text-amber",
};

/** A private note for the buyer under a vendor message. It is never sent to the vendor. */
function InsightCard({ kind, tone, text }: { kind: string; tone: string; text: string }) {
  return (
    <aside className={`mx-auto mt-2 w-[min(92%,44rem)] rounded-m border border-dashed px-3.5 py-2.5 ${INSIGHT_TONE[tone] ?? INSIGHT_TONE.info}`} aria-label="Private note, only you can see this">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
        <Icon name="bulb" size={14} />
        {INSIGHT_LABEL[kind] ?? "Note"}
        <span className="font-medium normal-case tracking-normal opacity-90">· only you can see this</span>
      </p>
      <p className="mt-1 text-sm leading-snug text-ink">{text}</p>
    </aside>
  );
}

function Ticks({ seen }: { seen: boolean }) {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" aria-label={seen ? "Seen" : "Delivered"} role="img" className={seen ? "text-brand" : "text-muted"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6l3 3 6-7" />
      {seen && <path d="M6 9l1 1 7-8" />}
    </svg>
  );
}

/** "Name is typing…" with three bouncing dots, on the side of whoever is writing. `label` reads "<name> is typing". */
export function TypingDots({ label, side = "vendor" }: { label: string; side?: "us" | "vendor" }) {
  const ours = side === "us";
  const name = label.replace(/ (is|are) typing$/, "");
  return (
    <div className={`mt-3 flex items-start gap-2 ${ours ? "justify-end" : "justify-start"}`} role="status">
      {!ours && <Avatar name={name} />}
      <div
        className={`rounded-[14px] px-3.5 py-2.5 shadow-sm ${
          ours ? "rounded-tr-[4px] bg-brand-soft" : "rounded-tl-[4px] border border-line bg-panel"
        }`}
      >
        <span aria-hidden className="shimmer-text text-sm font-medium italic">typing…</span>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

export function ChatLog({ turns, typing, vendorName, showInsights = false }: { turns: TurnView[]; typing?: string | { side: "us" | "vendor"; label: string } | null; vendorName: string; showInsights?: boolean }) {
  const who = typeof typing === "string" ? { side: "vendor" as const, label: typing } : typing;
  const base = turns[0]?.at ?? "";
  return (
    <div role="log" aria-live="polite" aria-label="Conversation" className="grid pb-2">
      {turns.length === 0 && !who && <p className="py-6 text-center text-sm text-muted">No messages yet.</p>}
      {turns.map((t, idx) => {
        const ours = t.speaker === "us";
        const prev = idx > 0 ? turns[idx - 1] : null;
        const when = stamp(base, t.elapsed_minutes);
        const day = Math.floor(t.elapsed_minutes / 1440) + 1;
        const newDay = !prev || Math.floor(prev.elapsed_minutes / 1440) + 1 !== day;
        const waited = !!prev && t.delay_minutes >= 60;
        const startsGroup = !prev || prev.speaker !== t.speaker || newDay || waited;
        // Our message counts as seen once the vendor has written after it.
        const seen = ours && turns.slice(idx + 1).some((x) => x.speaker !== "us");
        return (
          <div key={t.seq}>
            {newDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-panel px-3 py-1 text-xs font-semibold text-muted shadow-sm ring-1 ring-line2">
                  Day {day} · {weekday(when)}
                </span>
              </div>
            )}
            {waited && !newDay && (
              <div className="my-3 flex justify-center" role="separator" aria-label={`${ours ? "You wrote back" : "Replied"} after ${duration(t.delay_minutes)}`}>
                <span className="rounded-full bg-raise px-3 py-1 text-xs font-medium text-muted ring-1 ring-line2">
                  {ours ? "You wrote back after" : "Replied after"} {duration(t.delay_minutes)}
                </span>
              </div>
            )}
            <div className={`flex items-start gap-2 ${ours ? "justify-end" : "justify-start"} ${startsGroup ? "mt-3" : "mt-0.5"}`}>
              {!ours && (startsGroup ? <Avatar name={vendorName} /> : <span className="w-8 shrink-0" aria-hidden />)}
              <div
                className={`max-w-[78%] rounded-[14px] px-3 pb-1.5 pt-2 text-[14px] leading-snug shadow-sm ${
                  ours ? "bg-brand-soft text-ink" : "border border-line bg-panel text-ink"
                } ${startsGroup ? (ours ? "rounded-tr-[4px]" : "rounded-tl-[4px]") : ""}`}
              >
                {startsGroup && !ours && <p className="mb-0.5 text-xs font-bold" style={{ color: colourFor(vendorName) }}>{vendorName}</p>}
                {ours && t.tactic && TACTIC_LABEL[t.tactic] && (
                  <p className="mb-1 text-xs font-semibold tracking-wide text-brand" title="What this message is doing (visible to you only)">
                    {TACTIC_LABEL[t.tactic]}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{t.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-4">
                  {t.price != null ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-raise ring-1 ring-line2 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink">
                      <span className="text-muted">Offer</span> {money(t.price)}
                      {t.payment_code && <span className="text-muted">· {t.payment_code}</span>}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted" title={`${duration(t.elapsed_minutes)} into the conversation`}>
                    {clockTime(when)}
                    {ours && <Ticks seen={seen} />}
                  </span>
                </div>
              </div>
            </div>
            {showInsights && t.insights?.map((n, k) => <InsightCard key={k} kind={n.kind} tone={n.tone} text={n.text} />)}
          </div>
        );
      })}
      {who && <TypingDots label={who.label} side={who.side} />}
    </div>
  );
}
