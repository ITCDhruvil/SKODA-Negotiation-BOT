"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { api, type SessionView } from "@/lib/api";

const PROMPTS = [
  "What is your delivery time?",
  "What are the payment terms?",
  "Can you do a little better on the price?",
  "Is there any warranty?",
  "How long is your rate valid?",
  "Can you confirm the quantity?",
];

const roundBtn = "grid h-10 w-10 shrink-0 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Message bar in the style of a chat app: a "+" menu, the text field, and a send button that turns into a
 * stop button while the conversation runs on its own. Typing is only possible once the buyer has taken over.
 */
export function ChatComposer({
  session,
  running,
  busy,
  onStop,
  onResult,
  onError,
  typed = null,
}: {
  session: SessionView;
  running: boolean;
  busy: boolean;
  /** Our next message as it is being typed into the bar, before it is sent. Null when nothing is being typed. */
  typed?: string | null;
  onStop: () => void;
  onResult: (s: SessionView) => void;
  onError: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [offer, setOffer] = useState<{ price: string; payment: string } | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "40px";
    if (typed ?? text) el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 140)}px`;
  }, [text, typed]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Taking over puts the cursor straight in the field.
  useEffect(() => {
    if (!running) field.current?.focus({ preventScroll: true });
  }, [running]);

  const canSend = !running && !sending && (offer ? offer.price.trim() !== "" : text.trim() !== "");

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const next = offer
        ? await api.sendMessage(session.id, { price: Number(offer.price), payment_code: offer.payment.trim() || null, text: text.trim() || null })
        : await api.askQuestion(session.id, text.trim());
      onResult(next);
      setText("");
      setOffer(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div ref={root} className="relative grid gap-2">
      {!running && (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Suggested messages">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setText(p);
                field.current?.focus();
              }}
              className="shrink-0 whitespace-nowrap rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-text hover:border-brand"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {offer && (
        <div className="flex flex-wrap items-center gap-2 rounded-m bg-brand-soft px-3 py-2 text-sm">
          <span className="font-semibold text-ink">Offer</span>
          <label className="flex items-center gap-1">
            <span className="text-xs text-muted">₹ per unit</span>
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Offer price per unit"
              value={offer.price}
              onChange={(e) => setOffer({ ...offer, price: e.target.value })}
              className="w-24 rounded-chip border border-line bg-panel px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-xs text-muted">Payment</span>
            <input
              aria-label="Payment terms"
              placeholder="e.g. ZD45"
              value={offer.payment}
              onChange={(e) => setOffer({ ...offer, payment: e.target.value })}
              className="w-24 rounded-chip border border-line bg-panel px-2 py-1 text-sm text-ink"
            />
          </label>
          <button type="button" aria-label="Remove offer" onClick={() => setOffer(null)} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-panel">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-[28px] border bg-raise px-2 py-2 transition focus-within:border-brand ${
          typed !== null ? "border-brand" : "border-line"
        } ${running && typed === null ? "opacity-80" : ""}`}
      >
        <div className="relative">
          <button
            type="button"
            aria-label="Add to message"
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={running}
            onClick={() => setMenu((m) => !m)}
            className={`${roundBtn} text-ink hover:bg-panel`}
          >
            <Icon name="plus" size={20} />
          </button>
          {menu && (
            <div role="menu" className="absolute bottom-12 left-0 z-30 w-60 rounded-m border border-line bg-panel py-1 shadow-card">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOffer(offer ?? { price: "", payment: "" });
                  setMenu(false);
                }}
                className="block w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-brand-soft"
              >
                Add a price offer
                <span className="block text-xs text-muted">Send a price with your message</span>
              </button>
              {PROMPTS.slice(0, 3).map((p) => (
                <button
                  key={p}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setText(p);
                    setMenu(false);
                    field.current?.focus();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-brand-soft"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          ref={field}
          rows={1}
          value={typed !== null ? `${typed}\u258d` : text}
          readOnly={typed !== null}
          disabled={running && typed === null}
          aria-label="Message"
          placeholder={running ? "Messages are going out automatically. Press stop to write your own." : offer ? "Add a note (optional)" : "Message the vendor"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="h-10 max-h-36 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none"
        />

        {running ? (
          <button type="button" aria-label="Stop and take over" title="Stop and take over" disabled={busy} onClick={onStop} className={`${roundBtn} bg-ink text-bg hover:opacity-90`}>
            <span className="block h-3.5 w-3.5 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button type="button" aria-label="Send" disabled={!canSend} onClick={() => void send()} className={`${roundBtn} bg-brand text-on-brand hover:opacity-90`}>
            <Icon name="send" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
