"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHeader, ChatLog } from "@/components/negotiation/ChatLog";
import { NextVendorsLoader } from "@/components/negotiation/NextBestVendors";
import { ProfileDialog } from "@/components/negotiation/ProfileDialog";
import { ChatComposer } from "@/components/negotiation/ChatComposer";
import { Icon } from "@/components/ui/Icon";
import { Button, ButtonLink, Field, Pill, inputClass } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";
import { buildResult, inAis, markSent, notifyAisDone, openCaseInAis, sendToAis, wasSent } from "@/lib/ais";
import { api, type DraftView, type Mode, type SessionView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { deltaLabel } from "@/lib/labels";

// A short pause before the next round starts, once the last message has been shown.
const stepDelay = () => 900 + Math.floor(Math.random() * 900);

/** How long someone would take to type this message: longer messages take longer, with a little variation. */
function typingMs(text: string, side: "us" | "vendor", seq: number): number {
  const base = side === "us" ? 800 : 1000;
  const perChar = side === "us" ? 16 : 22;
  return Math.min(4200, Math.max(1200, base + text.length * perChar + ((seq * 137) % 700)));
}

type Handlers = { onResult: (s: SessionView) => void; onError: (m: string) => void };

function DraftCard({ s, onResult, onError }: { s: SessionView } & Handlers) {
  const d = s.pending_draft as DraftView;
  const [price, setPrice] = useState(String(d.price ?? ""));
  const [payment, setPayment] = useState(d.payment_code ?? "");
  const [text, setText] = useState(d.text);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrice(String(d.price ?? ""));
    setPayment(d.payment_code ?? "");
    setText(d.text);
  }, [d.id, d.price, d.payment_code, d.text]);

  const run = async (fn: () => Promise<SessionView>) => {
    setBusy(true);
    try {
      onResult(await fn());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const edit: { price?: number; payment_code?: string | null; text?: string | null } = {};
    if (d.price != null && Number(price) !== d.price) edit.price = Number(price);
    if ((payment || null) !== (d.payment_code ?? null)) edit.payment_code = payment || null;
    if (text !== d.text) edit.text = text;
    return run(() => api.approveDraft(s.id, d.id, edit));
  };

  return (
    <div className="rounded-card border border-brand bg-brand-soft/40 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Drafted message: review before it goes out</h3>
        <Pill tone="brand">{d.kind === "offer" ? "Offer" : d.kind === "accept" ? "Accept" : "Hand back"}</Pill>
      </div>
      <p className="mb-3 text-xs text-muted">{d.rationale}</p>
      {d.price != null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price per unit">
            <input className={`${inputClass} min-h-[44px]`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Payment terms">
            <input className={`${inputClass} min-h-[44px]`} value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="e.g. ZD45" />
          </Field>
        </div>
      )}
      <div className="mt-3">
        <Field label="Message">
          <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={send}>
          Send
        </Button>
        <Button disabled={busy} onClick={() => run(() => api.discardDraft(s.id, d.id))}>
          Discard
        </Button>
      </div>
    </div>
  );
}

/**
 * One negotiation as the buyer watches it. Messages are shown one at a time, each after a typing pause, and the bot's
 * own message is typed into the message bar before it is sent, so the buyer sees how the bot negotiates instead of a
 * finished transcript. When the session runs on its own (full auto) this also moves it on, one round at a time.
 * `drive: false` leaves the advancing to the caller; `onView` reports every new state of the session.
 */
export function useLiveChat(initial: SessionView, opts: { drive?: boolean; onView?: (s: SessionView) => void } = {}) {
  const { drive = true, onView } = opts;
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(initial.turns.length);
  const [typing, setTyping] = useState<{ side: "us" | "vendor"; label: string } | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const report = useRef(onView);
  report.current = onView;

  const revealing = visible < s.turns.length;
  // The end of a conversation (agreed, handed back) is only announced after its last message has been shown.
  const shownStatus = revealing && s.status !== "active" ? "active" : s.status;

  useEffect(() => {
    if (s.turns.length < visible) {
      setVisible(s.turns.length);
      return;
    }
    if (visible >= s.turns.length) {
      setTyping(null);
      return;
    }
    const next = s.turns[visible];
    const side = next.speaker === "us" ? "us" : "vendor";
    if (side === "us" && next.author === "human") {
      setVisible((v) => v + 1); // what the buyer typed by hand appears at once
      return;
    }
    if (side === "us") {
      // Our message is typed into the message bar a few characters at a time, then sent.
      const text = next.text;
      const total = Math.min(5200, Math.max(1500, text.length * 26));
      const started = Date.now();
      setTyping(null);
      setTyped("");
      let sendTimer: ReturnType<typeof setTimeout> | undefined;
      const tick = setInterval(() => {
        const n = Math.min(text.length, Math.ceil((text.length * (Date.now() - started)) / total));
        setTyped(text.slice(0, n));
        if (n >= text.length) {
          clearInterval(tick);
          sendTimer = setTimeout(() => {
            setTyped(null);
            setVisible((v) => v + 1);
          }, 450);
        }
      }, 40);
      return () => {
        clearInterval(tick);
        if (sendTimer) clearTimeout(sendTimer);
        setTyped(null);
      };
    }
    setTyping({ side, label: `${s.vendor_name} is typing` });
    const t = setTimeout(() => {
      setTyping(null);
      setVisible((v) => v + 1);
    }, typingMs(next.text, side, next.seq));
    return () => clearTimeout(t);
  }, [visible, s.turns, s.vendor_name]);

  const apply = useCallback((next: SessionView) => {
    setError(null);
    setS(next);
    report.current?.(next);
  }, []);

  // Full auto: one round per tick, only once the last message has been shown. A mode change, a status change or an error ends the loop.
  const autoOn = s.mode === "auto" && s.status === "active" && s.actions.can_advance;
  useEffect(() => {
    if (!drive || !autoOn || revealing) return;
    stop.current = false;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled || stop.current) return;
      try {
        const next = await api.advance(s.id);
        if (!cancelled && !stop.current) apply(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, stepDelay());
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [drive, autoOn, revealing, s.round, s.id, s.turns.length, apply]);

  const act = async (fn: () => Promise<SessionView>) => {
    setBusy(true);
    try {
      apply(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (m: Mode) => {
    stop.current = true;
    return act(() => api.setMode(s.id, m));
  };

  return { s, error, setError, visible, revealing, typing, typed, busy, shownStatus, autoOn, apply, act, changeMode };
}

export type LiveChat = ReturnType<typeof useLiveChat>;

/** The conversation itself: header, messages, and the bar at the bottom for what the buyer can do next. */
export function ConversationPanel({
  chat,
  className = "",
  id,
  labelledBy,
  hidden = false,
  headerExtra,
}: {
  chat: LiveChat;
  className?: string;
  id?: string;
  labelledBy?: string;
  hidden?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const { s, error, setError, visible, revealing, typing, typed, busy, shownStatus, autoOn, apply, act, changeMode } = chat;
  const d = s.direction;
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<"us" | "vendor" | null>(null);
  const [accepted, setAccepted] = useState(false);
  // A case that came from the AIS prototype ends by sending its result back there, after the Buyer confirms it.
  const [sent, setSent] = useState(false);
  useEffect(() => setSent(wasSent(s.id)), [s.id]);
  // Private notes under the vendor's messages can be hidden; the choice is remembered.
  const [showInsights, setShowInsights] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("chat:insights") === "0") setShowInsights(false);
    } catch {
      /* storage may be blocked */
    }
  }, []);
  const toggleInsights = () =>
    setShowInsights((on) => {
      try {
        window.localStorage.setItem("chat:insights", on ? "0" : "1");
      } catch {
        /* storage may be blocked */
      }
      return !on;
    });
  // Keep the newest message in view.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [visible, typing, s.id]);

  const sendResult = async (status: "AGREED" | "FAILED") => {
    sendToAis(buildResult(s, status));
    markSent(s.id);
    setSent(true);
    if (status === "AGREED") {
      // The agreed deal is also closed here, so its contract document can be opened from AIS.
      try {
        await api.acceptDeal(s.item_id);
        await api.approveEvent(s.event_id);
        apply(await api.session(s.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    // Inside AIS the request moves to its next step; on its own the Desk goes to the deal's review.
    if (!notifyAisDone(s.event_id, status)) router.push(status === "AGREED" ? `/events/${s.event_id}/approve` : `/events/${s.event_id}`);
  };

  const acceptDeal = async () => {
    try {
      await api.acceptDeal(s.item_id);
      setAccepted(true);
      setError(null);
      router.push(`/events/${s.event_id}/approve`); // one step: accepting sends the deal straight to its review
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
        <section id={id} role={id ? "tabpanel" : undefined} aria-labelledby={labelledBy} className={`${hidden ? "hidden" : "flex"} min-h-[32rem] flex-col rounded-card border border-line bg-panel shadow-card ${className}`} aria-label={`Conversation with ${s.vendor_name}`}>
          <header className="shrink-0 border-b border-line2 px-4 py-3">
            <ChatHeader
              name={s.vendor_name}
              subtitle={shownStatus === "active" ? "online" : shownStatus === "on_hold" ? "On hold" : shownStatus === "agreed" ? "Deal agreed" : s.vendor_ended ? "Left the conversation" : "Conversation ended"}
              typing={typing?.side === "vendor"}
              live={shownStatus === "active"}
              onProfile={() => setProfile("vendor")}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {headerExtra}
                  {s.from_ais && inAis() && (
                    <button
                      type="button"
                      onClick={() => openCaseInAis(s.event_id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand"
                    >
                      <Icon name="external" size={14} /> Open case in AIS
                    </button>
                  )}
                <button
                  type="button"
                  onClick={toggleInsights}
                  aria-pressed={showInsights}
                  title="Private notes for you under the vendor's messages: other quotes, history, hints"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${showInsights ? "border-brand bg-brand-soft text-brand" : "border-line bg-panel text-muted hover:border-brand"}`}
                >
                  <Icon name="bulb" size={14} /> Insights {showInsights ? "on" : "off"}
                </button>
                </div>
              }
            />
          </header>
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto bg-raise px-4 py-3"
            style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--line) 80%, transparent) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
          >
            <ChatLog turns={s.turns.slice(0, visible)} typing={typing} vendorName={s.vendor_name} showInsights={showInsights} onProfile={setProfile} />
          </div>
          <div className="grid max-h-[60%] shrink-0 gap-3 overflow-y-auto border-t border-line2 p-3">
            {error && <Notice tone="red">{error}</Notice>}

            {shownStatus === "active" && !revealing && s.pending_draft && <DraftCard s={s} onResult={apply} onError={setError} />}

            {shownStatus === "active" && !revealing && s.mode === "approve" && !s.pending_draft && s.actions.can_advance && (
              <div>
                <Button variant="primary" disabled={busy} onClick={() => act(() => api.advance(s.id))}>
                  Prepare next message
                </Button>
              </div>
            )}

            {shownStatus === "active" && (
              <ChatComposer
                session={s}
                running={autoOn || revealing}
                busy={busy || revealing}
                typed={typed}
                onStop={() => changeMode("manual")}
                onResult={apply}
                onError={setError}
              />
            )}

            {shownStatus === "agreed" && (
              <div className="rounded-card border border-transparent bg-ok-soft px-4 py-3.5" role="status">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand">
                      <Icon name="check" size={22} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-ok">Deal agreed</p>
                      <p className="text-xl font-extrabold leading-tight tabular-nums text-ink">
                        {money(s.agreed_price)}
                        <span className="ml-1.5 text-sm font-semibold text-muted">
                          per {s.unit}
                          {s.agreed_payment ? ` · ${s.agreed_payment}` : ""}
                        </span>
                      </p>
                    </div>
                  </div>
                  <dl className="flex flex-1 flex-wrap gap-x-8 gap-y-2">
                    {(
                      [
                        [deltaLabel(d), money(s.agreed_delta), true],
                        ["Original quote", `${money(s.original_price)} per ${s.unit}`, false],
                        ["Quantity", `${num(s.qty)} ${s.unit}`, false],
                        ["Deal value", money(s.agreed_value), false],
                      ] as [string, string, boolean][]
                    ).map(([k, v, good]) => (
                      <div key={k}>
                        <dt className="text-xs text-muted">{k}</dt>
                        <dd className={`text-sm font-bold tabular-nums ${good ? "text-ok" : "text-ink"}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {s.actions.others_open > 0 ? (
                      <>
                        <span className="text-sm text-muted">
                          Waiting for {s.actions.others_open} other {s.actions.others_open === 1 ? "negotiation" : "negotiations"} to finish.
                        </span>
                        <ButtonLink href={`/items/${s.item_id}?tab=compare`} variant="primary" size="md">
                          Compare vendors
                        </ButtonLink>
                      </>
                    ) : s.from_ais ? (
                      sent ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-sm font-semibold text-ok ring-1 ring-line2">
                          <Icon name="check" size={15} />
                          Sent to AIS: handed over at NB 9
                        </span>
                      ) : (
                        <>
                          {s.actions.can_continue && (
                            <Button disabled={busy} onClick={() => act(() => api.continueNegotiation(s.item_id))}>
                              Keep negotiating
                            </Button>
                          )}
                          <Button variant="primary" onClick={() => sendResult("AGREED")}>
                            Confirm and send to AIS
                          </Button>
                        </>
                      )
                    ) : accepted || (!s.actions.can_accept_deal && !s.actions.can_continue) ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-sm font-semibold text-ok ring-1 ring-line2">
                          <Icon name="check" size={15} />
                          Sent for approval
                        </span>
                        <ButtonLink href={`/events/${s.event_id}/approve`} variant="primary" size="md">
                          Review &amp; approve
                        </ButtonLink>
                      </>
                    ) : (
                      <>
                        {s.actions.can_continue && (
                          <Button disabled={busy} onClick={() => act(() => api.continueNegotiation(s.item_id))}>
                            Keep negotiating
                          </Button>
                        )}
                        {s.actions.can_accept_deal && (
                          <Button variant="primary" disabled={busy} onClick={acceptDeal}>
                            {busy ? "Sending…" : "Accept & send for review"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {shownStatus === "handed_back" && (
              <div className="rounded-card border border-transparent bg-red-soft p-4 text-sm text-red" role="status">
                <p className="font-bold">{s.vendor_ended ? "The vendor ended the conversation" : "Handed back to you"}</p>
                <p className="mt-1">{s.handback_reason ?? "No acceptable deal could be reached within your limits."}</p>
                <div className="mt-3 rounded-m bg-panel p-3 text-ink">
                  <p className="mb-2 text-sm font-bold">Try the next-best vendor</p>
                  <NextVendorsLoader itemId={s.item_id} mode={s.mode} unit={s.unit} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.from_ais ? (
                    sent ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-line2">
                        <Icon name="check" size={15} />
                        Result sent to AIS
                      </span>
                    ) : (
                      <Button onClick={() => sendResult("FAILED")}>Send &ldquo;no agreement&rdquo; to AIS</Button>
                    )
                  ) : (
                    <Link href={`/items/${s.item_id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink">
                      Back to item
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      <ProfileDialog who={profile} session={s} onClose={() => setProfile(null)} />
    </>
  );
}
