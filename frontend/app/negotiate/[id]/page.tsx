"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatLog } from "@/components/negotiation/ChatLog";
import { ModeSelect } from "@/components/negotiation/ModeSelect";
import { QuestionBox } from "@/components/negotiation/QuestionBox";
import { Select } from "@/components/ui/Select";
import { Button, DirectionBadge, Field, Panel, Pill, inputClass } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { ApiError, api, type DraftView, type Mode, type SessionView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { LANGUAGE_LABEL, deltaLabel, limitLabel } from "@/lib/labels";

// Replies arrive after a short, uneven pause, the way a person would write back.
const stepDelay = () => 1400 + Math.floor(Math.random() * 1600);

function useSession(id: string) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  useEffect(() => {
    let live = true;
    setSession(null);
    setError(null);
    api
      .session(id)
      .then((s) => live && setSession(s))
      .catch(
        (e) =>
          live &&
          setError({ message: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : null }),
      );
    return () => {
      live = false;
    };
  }, [id]);
  return { session, error };
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
    <div className="rounded-l border border-brand bg-brand-soft/40 p-4">
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

function Composer({ s, onResult, onError }: { s: SessionView } & Handlers) {
  const [price, setPrice] = useState("");
  const [payment, setPayment] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onResult(await api.sendMessage(s.id, { price: Number(price), payment_code: payment || null, text: text || null }));
      setPrice("");
      setPayment("");
      setText("");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-l border border-line bg-raise p-4">
      <h3 className="text-sm font-bold text-ink">Your offer</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price per unit">
          <input required className={`${inputClass} min-h-[44px]`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Payment terms (optional)">
          <input className={`${inputClass} min-h-[44px]`} value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="e.g. ZD45" />
        </Field>
      </div>
      <Field label="Message (optional)" hint="Leave empty to use the standard wording in the vendor's language.">
        <textarea className={inputClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || price.trim() === ""}>
          Send offer
        </Button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line2 py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function Workspace({ initial }: { initial: SessionView }) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [accepted, setAccepted] = useState(false);
  const stop = useRef(false);

  const apply = useCallback((next: SessionView) => {
    setError(null);
    setS(next);
  }, []);

  // Full auto: one round per tick. A mode change, a status change or an error ends the loop.
  const autoOn = s.mode === "auto" && s.status === "active" && s.actions.can_advance;
  useEffect(() => {
    if (!autoOn) return;
    stop.current = false;
    let cancelled = false;
    setTyping(`${s.vendor_name} is typing`);
    const t = setTimeout(async () => {
      if (cancelled || stop.current) return;
      try {
        const next = await api.advance(s.id);
        if (!cancelled && !stop.current) apply(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTyping(null);
      }
    }, stepDelay());
    return () => {
      cancelled = true;
      clearTimeout(t);
      setTyping(null);
    };
  }, [autoOn, s.round, s.id, s.turns.length, s.vendor_name, apply]);

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

  const acceptDeal = async () => {
    setBusy(true);
    try {
      await api.acceptDeal(s.item_id);
      setAccepted(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const i = s.intelligence;
  const d = s.direction;
  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href={`/events/${s.event_id}`} className="hover:underline">{s.event_id}</Link> /{" "}
            <Link href={`/items/${s.item_id}`} className="hover:underline">{s.item_description}</Link> / Negotiation
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.vendor_name}
            <DirectionBadge direction={d} />
            <Pill tone={s.status === "agreed" ? "ok" : s.status === "handed_back" ? "red" : "amber"}>
              {s.status === "agreed" ? "Agreed" : s.status === "handed_back" ? "Handed back" : `Round ${s.round}`}
            </Pill>
          </span>
        }
        subtitle={`${s.item_description} · ${num(s.qty)} ${s.unit}`}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Conversation"
          subtitle={autoOn ? "Running automatically." : undefined}
          actions={
            autoOn ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => changeMode("manual")}>
                Stop &amp; take over
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-4">
            {error && <Notice tone="red">{error}</Notice>}
            <ChatLog turns={s.turns} typing={typing} vendorName={s.vendor_name} />

            {s.status === "active" && s.pending_draft && <DraftCard s={s} onResult={apply} onError={setError} />}

            {s.status === "active" && s.mode === "approve" && !s.pending_draft && s.actions.can_advance && (
              <div>
                <Button variant="primary" disabled={busy} onClick={() => act(() => api.advance(s.id))}>
                  Prepare next message
                </Button>
              </div>
            )}

            {s.status === "active" && s.mode === "manual" && s.actions.can_send && (
              <Composer s={s} onResult={apply} onError={setError} />
            )}

            {s.status === "active" && <QuestionBox sessionId={s.id} onResult={apply} onError={setError} />}

            {s.status === "agreed" && (
              <div className="rounded-l border border-transparent bg-ok-soft p-4 text-sm text-ok" role="status">
                <p className="text-base font-bold">
                  Agreed at {money(s.agreed_price)} per {s.unit}
                  {s.agreed_payment ? ` · ${s.agreed_payment}` : ""}
                </p>
                <p className="mt-1">
                  {deltaLabel(d)}: <span className="font-bold tabular-nums">{money(s.agreed_delta)}</span> on {num(s.qty)} {s.unit} (original{" "}
                  {money(s.original_price)}).
                </p>
                {accepted ? (
                  <p className="mt-3">
                    Sent for approval.{" "}
                    <Link href={`/events/${s.event_id}/approve`} className="font-semibold underline">
                      Review &amp; approve
                    </Link>
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.actions.can_accept_deal && (
                      <Button variant="primary" disabled={busy} onClick={acceptDeal}>
                        Accept deal
                      </Button>
                    )}
                    {s.actions.can_continue && (
                      <Button disabled={busy} onClick={() => act(() => api.continueNegotiation(s.item_id))}>
                        Keep negotiating
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {s.status === "handed_back" && (
              <div className="rounded-l border border-transparent bg-red-soft p-4 text-sm text-red" role="status">
                <p className="font-bold">Handed back to you</p>
                <p className="mt-1">{s.handback_reason ?? "No acceptable deal could be reached within your limits."}</p>
                <div className="mt-3">
                  <Link href={`/items/${s.item_id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink">
                    Back to item
                  </Link>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <div className="grid content-start gap-5">
          <Panel title="Permission">
            <ModeSelect id="ws-mode" value={s.mode} onChange={changeMode} disabled={busy || s.status !== "active"} />
          </Panel>
          <Panel title="Conversation language" subtitle="Applies to the messages that follow.">
            <Select<"en" | "hi" | "mr">
              id="ws-language"
              ariaLabel="Conversation language"
              value={s.language}
              disabled={busy || s.status !== "active"}
              onChange={(l) => act(() => api.setLanguage(s.id, l))}
              options={(["en", "hi", "mr"] as const).map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
            />
          </Panel>
          <Panel title="Live intelligence" subtitle={s.status === "active" ? undefined : "Final position"}>
            <dl>
              <Row label="Original quote">{money(i.current_bid)}</Row>
              <Row label="Latest vendor offer">{money(i.latest_vendor_offer)}</Row>
              <Row label="Our last offer">{money(i.our_offer)}</Row>
              <Row label="Movement / unit">{money(i.movement)}</Row>
              <Row label="Target">{money(i.target)}</Row>
              <Row label={limitLabel(d)}>{money(i.limit)}</Row>
              <Row label={`${deltaLabel(d)} if accepted`}>{i.delta_if_accepted == null ? "Outside limit" : money(i.delta_if_accepted)}</Row>
              <Row label={`Potential ${deltaLabel(d).toLowerCase()}`}>{money(i.potential_delta)}</Row>
            </dl>
            <p className="mt-3 rounded-m bg-raise p-3 text-sm text-text">{i.recommendation}</p>
          </Panel>
          {s.status === "active" && (s.actions.can_accept_offer || s.actions.can_hand_back) && (
            <Panel title="Actions">
              <div className="grid gap-2">
                {s.actions.can_accept_offer && (
                  <Button variant="primary" disabled={busy} onClick={() => act(() => api.acceptOffer(s.id))}>
                    Accept vendor&rsquo;s offer
                  </Button>
                )}
                {s.actions.can_hand_back && (
                  <Button disabled={busy} onClick={() => setHandBackOpen(true)}>
                    Hand back to me
                  </Button>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Dialog
        open={handBackOpen}
        title="Hand this negotiation back?"
        onClose={() => setHandBackOpen(false)}
        footer={
          <>
            <Button onClick={() => setHandBackOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setHandBackOpen(false);
                await act(() => api.handBack(s.id, reason || undefined));
              }}
            >
              Hand back
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">The conversation stops. You can close the item without a deal, or set new points and start again.</p>
        <Field label="Reason (optional)">
          <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

export default function NegotiatePage() {
  const { id } = useParams<{ id: string }>();
  const { session, error } = useSession(id);
  if (error) return <ErrorBox message={error.message} status={error.status} />;
  if (!session) return <Loading label="Loading negotiation" />;
  return <Workspace key={session.id} initial={session} />;
}
