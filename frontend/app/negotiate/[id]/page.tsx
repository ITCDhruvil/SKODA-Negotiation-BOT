"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConversationPanel, useLiveChat } from "@/components/negotiation/LiveChat";
import { HandlingCard } from "@/components/item/HandlingCard";
import { ModeSelect } from "@/components/negotiation/ModeSelect";
import { StrategyPanel } from "@/components/negotiation/StrategyPanel";
import { Select } from "@/components/ui/Select";
import { Button, DirectionBadge, Field, Pill, inputClass } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { ApiError, api, type Mode, type SessionView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { LANGUAGE_LABEL, deltaLabel, limitLabel } from "@/lib/labels";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line2 py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function Workspace({ initial }: { initial: SessionView }) {
  const chat = useLiveChat(initial);
  const { s, busy, shownStatus, act, changeMode } = chat;
  // On a wide screen the conversation fills the space below the page heading, so the page itself never scrolls;
  // only the messages (and the side panels) scroll inside it.
  const layout = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (window.innerWidth < 1280) return setFit(null);
      if (document.documentElement.dataset.embed === "1") return setFit(680); // a frame grows with its content, so use a fixed height
      const top = (layout.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      setFit(Math.max(520, Math.floor(window.innerHeight - top - 20)));
    };
    measure();
    const later = setTimeout(measure, 400); // once fonts and the heading have settled
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(later);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [view, setView] = useState<ViewKey>("chat");
  const [reason, setReason] = useState("");

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
            <Pill tone={shownStatus === "agreed" ? "ok" : shownStatus === "handed_back" ? "red" : shownStatus === "on_hold" ? "info" : "amber"}>
              {shownStatus === "agreed" ? "Agreed" : shownStatus === "handed_back" ? (s.vendor_ended ? "Vendor left" : "Handed back") : shownStatus === "on_hold" ? "On hold" : `Round ${s.round}`}
            </Pill>
          </span>
        }
        subtitle={`${s.item_description} · ${num(s.qty)} ${s.unit}`}
      />

      <div className="mb-4">
        <Tabs
          idPrefix="ws"
          value={view}
          onChange={setView}
          tabs={[
            { key: "chat", label: "Conversation" },
            { key: "overview", label: "Overview" },
            { key: "live", label: "Live intelligence" },
            { key: "strategy", label: "Strategy" },
            { key: "settings", label: "Settings" },
          ]}
        />
      </div>

      <div ref={layout} className="grid gap-5" style={fit && view === "chat" ? { height: fit } : undefined}>
        {/* The chat fills the height of the window: messages scroll in the middle, the answer bar stays at the bottom. */}
        <ConversationPanel chat={chat} id={panelId("ws", "chat")} labelledBy={tabId("ws", "chat")} hidden={view !== "chat"} className="xl:h-full xl:min-h-0" />

        <SidePanel
          tab={view === "chat" ? null : view}
          s={s}
          i={i}
          d={d}
          busy={busy}
          shownStatus={shownStatus}
          act={act}
          changeMode={changeMode}
          onHandBack={() => setHandBackOpen(true)}
        />
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

type SideKey = "overview" | "settings" | "strategy" | "live";
type ViewKey = "chat" | SideKey;

/** Everything about this conversation except the messages, in tabs instead of one long column. */
function SidePanel({
  tab,
  s,
  i,
  d,
  busy,
  shownStatus,
  act,
  changeMode,
  onHandBack,
}: {
  tab: SideKey | null;
  s: SessionView;
  i: SessionView["intelligence"];
  d: SessionView["direction"];
  busy: boolean;
  shownStatus: string;
  act: (fn: () => Promise<SessionView>) => Promise<void>;
  changeMode: (m: Mode) => void;
  onHandBack: () => void;
}) {
  const router = useRouter();
  if (!tab) return null;
  return (
    <section className="min-w-0 rounded-card border border-line bg-panel shadow-card" aria-label="Negotiation details">
      <div role="tabpanel" id={panelId("ws", tab)} aria-labelledby={tabId("ws", tab)} className="max-w-3xl p-5">
        {tab === "overview" && (
          <div className="grid gap-4">
            <HandlingCard policy={s.policy} compact />
            {(s.actions.can_hold || s.status === "on_hold") && (
              <div className="rounded-card border border-line2 p-3.5">
                <h3 className="text-sm font-bold text-ink">Another vendor</h3>
                <p className="mb-3 mt-1 text-[13px] leading-snug text-muted">
                  {s.status === "on_hold"
                    ? "This negotiation is on hold. Nothing is sent and nothing is accepted. Carry on from the same point whenever you like."
                    : "Put this negotiation on hold, with its messages and prices kept, and talk to a different vendor. Nothing is accepted or ended."}
                </p>
                <div className="grid gap-2">
                  {s.status === "on_hold" && (
                    <Button variant="primary" disabled={busy || !s.actions.can_resume} onClick={() => act(() => api.resumeSession(s.id))}>
                      Resume this negotiation
                    </Button>
                  )}
                  {s.actions.can_hold && (
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        await act(() => api.holdSession(s.id));
                        router.push(`/items/${s.item_id}?tab=start`);
                      }}
                    >
                      Hold and choose another vendor
                    </Button>
                  )}
                  {s.status === "on_hold" && (
                    <Button disabled={busy} onClick={() => router.push(`/items/${s.item_id}?tab=start`)}>
                      Choose another vendor
                    </Button>
                  )}
                </div>
              </div>
            )}
            {s.status === "active" && (s.actions.can_accept_offer || s.actions.can_hand_back) && (
              <div className="rounded-card border border-line2 p-3.5">
                <h3 className="mb-3 text-sm font-bold text-ink">Decide</h3>
                <div className="grid gap-2">
                  {s.actions.can_accept_offer && (
                    <Button variant="primary" disabled={busy} onClick={() => act(() => api.acceptOffer(s.id))}>
                      Accept vendor&rsquo;s offer
                    </Button>
                  )}
                  {s.actions.can_hand_back && (
                    <Button disabled={busy} onClick={onHandBack}>
                      Hand back to me
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "live" && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
              {shownStatus === "active" && <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />}
              {shownStatus === "active" ? "Updating as the conversation moves" : "As the conversation stands"}
            </p>
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
          </div>
        )}

        {tab === "strategy" && <StrategyPanel strategy={s.strategy} bare />}

        {tab === "settings" && (
          <div className="grid gap-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Who sends the messages</p>
              <ModeSelect id="ws-mode" value={s.mode} onChange={changeMode} disabled={busy || s.status !== "active"} allowAuto={s.policy.auto_allowed} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Language</p>
              <Select<"en" | "hi" | "mr">
                id="ws-language"
                ariaLabel="Conversation language"
                value={s.language}
                disabled={busy || s.status !== "active"}
                onChange={(l) => act(() => api.setLanguage(s.id, l))}
                options={(["en", "hi", "mr"] as const).map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function NegotiatePage() {
  const { id } = useParams<{ id: string }>();
  const { session, error } = useSession(id);
  if (error) return <ErrorBox message={error.message} status={error.status} />;
  if (!session) return <Loading label="Loading negotiation" />;
  return <Workspace key={session.id} initial={session} />;
}
