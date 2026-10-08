"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChatHeader, ChatLog } from "@/components/negotiation/ChatLog";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/State";
import { api, type SessionSummary, type SessionView } from "@/lib/api";
import { money } from "@/lib/format";
import { MODE_LABEL, SESSION_LABEL } from "@/lib/labels";

/** Every conversation on the item in one place: pick a vendor on the left and watch the chat on the right as it happens. */
export function LiveConversationsTab({
  sessions,
  views,
  onStartMore,
  onChanged,
}: {
  sessions: SessionSummary[];
  views: Record<string, SessionView>;
  onStartMore: () => void;
  onChanged: () => void;
}) {
  const itemId = sessions[0]?.item_id ?? "";
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(`hidden-conversations:${itemId}`) ?? "[]"));
    } catch {
      setHidden([]);
    }
  }, [itemId]);
  const saveHidden = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(`hidden-conversations:${itemId}`, JSON.stringify(next));
    } catch {
      /* the choice just isn't remembered */
    }
  };
  const allOrdered = [...sessions].reverse();
  const ordered = allOrdered.filter((s) => !hidden.includes(s.id));
  const hiddenCount = allOrdered.length - ordered.length;
  const [pick, setPick] = useState<string | null>(null);
  const current = ordered.find((s) => s.id === pick) ?? ordered.find((s) => s.status === "active") ?? ordered[0];
  const view = current ? views[current.id] : undefined;
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const turns = view?.turns.length ?? 0;

  // Keep the newest message in sight while the conversation grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, current?.id]);

  if (sessions.length === 0) {
    return (
      <Notice tone="info">
        No negotiation on this item yet. Once the quotes are analysed, open the &ldquo;Start negotiation&rdquo; tab to choose the vendors and begin.
      </Notice>
    );
  }

  const remove = async (s: SessionSummary) => {
    if (!window.confirm(`Remove ${s.vendor_name}? The conversation stops and is handed back. Its messages stay in the history.`)) return;
    setRemoving(s.id);
    setRemoveError(null);
    try {
      if (s.status === "on_hold") await api.resumeSession(s.id);
      await api.handBack(s.id, "Vendor removed by the buyer.");
      setPick(null);
      onChanged();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  const waitingOnYou = view?.mode === "approve" && view.status === "active" && !!view.pending_draft;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4">
        <div className="flex items-center gap-2 border-b border-line2">
        <div role="tablist" aria-label="Vendors" className="flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden">
          {ordered.map((s) => {
            const on = s.id === current?.id;
            return (
              <div key={s.id} className={`flex shrink-0 items-center border-b-2 ${on ? "border-brand" : "border-transparent"}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPick(s.id)}
                  title={`${s.vendor_name} · ${SESSION_LABEL[s.status]}`}
                  className={`inline-flex items-center gap-2 py-2.5 pl-4 text-sm font-semibold transition ${s.status !== "agreed" ? "pr-1.5" : "pr-4"} ${on ? "text-brand" : "text-muted hover:text-ink"}`}
                >
                  <StatusIcon status={s.status} label={SESSION_LABEL[s.status]} />
                  <span className="max-w-[16rem] truncate">{s.vendor_name}</span>
                </button>
                {s.status !== "agreed" && (
                  <button
                    type="button"
                    disabled={removing === s.id}
                    onClick={() => (running(s) ? void remove(s) : saveHidden([...hidden, s.id]))}
                    aria-label={running(s) ? `Remove ${s.vendor_name}` : `Hide ${s.vendor_name}`}
                    title={running(s) ? "Remove this vendor (ends the conversation)" : "Hide this conversation"}
                    className="mr-2 grid h-6 w-6 place-items-center rounded-full text-muted transition hover:bg-raise hover:text-red disabled:opacity-50"
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => saveHidden([])} className="mb-1 shrink-0 text-xs font-semibold text-muted hover:text-brand">
            Show hidden ({hiddenCount})
          </button>
        )}
        <button type="button" onClick={onStartMore} className="mb-1 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
          <Icon name="plus" size={14} />
          Add a vendor
        </button>
      </div>

        {removeError && <Notice tone="red">{removeError}</Notice>}

        {current && (
          <section className="flex h-[clamp(32rem,calc(100vh-14rem),52rem)] min-w-0 flex-col rounded-card border border-line bg-panel" aria-label={`Conversation with ${current.vendor_name}`}>
            <header className="shrink-0 border-b border-line2 px-4 py-3">
              <ChatHeader
                name={current.vendor_name}
                subtitle={
                  current.status === "active"
                    ? `${MODE_LABEL[current.mode]} · round ${current.round}`
                    : current.status === "agreed"
                      ? "Agreed"
                      : current.status === "on_hold"
                        ? "On hold"
                        : "Conversation ended"
                }
                typing={false}
                live={current.status === "active"}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1">
                    {view && (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                        <span>
                          Original quote <b className="text-ink">{money(view.original_price)}</b>
                        </span>
                        <span>
                          Vendor now <b className="text-ink">{money(view.vendor_offer)}</b>
                        </span>
                        {view.our_offer != null && (
                          <span>
                            Our offer <b className="text-ink">{money(view.our_offer)}</b>
                          </span>
                        )}
                      </div>
                    )}
                  <Link href={`/negotiate/${current.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-brand hover:text-brand">
                    Open workspace
                    <Icon name="external" size={13} />
                  </Link>
                  </div>
                }
              />
            </header>
            {waitingOnYou && (
              <div className="shrink-0 border-b border-line2 bg-amber-soft px-4 py-2 text-sm text-amber">
                A message is waiting for your approval.{" "}
                <Link href={`/negotiate/${current.id}`} className="font-semibold underline">
                  Open the workspace
                </Link>
              </div>
            )}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" >
              {view ? <ChatLog turns={view.turns} vendorName={current.vendor_name} showInsights /> : <p className="py-8 text-center text-sm text-muted">Loading the conversation…</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const running = (s: SessionSummary) => s.status === "active" || s.status === "on_hold";

/** Status as a small icon; the words are in the tooltip and the accessible name. */
function StatusIcon({ status, label }: { status: SessionSummary["status"]; label: string }) {
  if (status === "active")
    return (
      <span className="relative flex h-2.5 w-2.5" role="img" aria-label={label}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
      </span>
    );
  if (status === "agreed")
    return (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-ok-soft text-ok" role="img" aria-label={label}>
        <Icon name="check" size={10} />
      </span>
    );
  if (status === "on_hold")
    return (
      <span className="flex h-4 w-4 items-center justify-center gap-[2px] rounded-full bg-info-soft" role="img" aria-label={label}>
        <span className="h-2 w-[2px] rounded-sm bg-info" />
        <span className="h-2 w-[2px] rounded-sm bg-info" />
      </span>
    );
  return (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-red-soft" role="img" aria-label={label}>
      <span className="h-[2px] w-2 rounded-sm bg-red" />
    </span>
  );
}
