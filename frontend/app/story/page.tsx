"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { ChatLog } from "@/components/negotiation/ChatLog";
import { StrategyPanel } from "@/components/negotiation/StrategyPanel";
import { Button, Delta, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { Icon } from "@/components/ui/Icon";
import { ErrorBox, Loading, Notice } from "@/components/ui/State";
import { api, type ItemDetail, type SessionView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { deltaLabel, limitLabel, quoteLabel } from "@/lib/labels";

type Scenario = {
  key: "buy" | "sell" | "hard";
  direction: "buy" | "sell";
  vendor?: string; // negotiate with this vendor instead of the best quote
  label: string;
  event: string;
  item: string;
  target: number; // the buyer's inputs for the demo, entered as a person would
  limit: number;
  blurb: string;
};

const SCENARIOS: Scenario[] = [
  { key: "buy", direction: "buy", label: "Purchase story", event: "AIS-E1-2026-00077", item: "AIS-E1-2026-00077-01", target: 250, limit: 270, blurb: "Buying lunch for a delegation visit: we want a lower price per meal." },
  { key: "hard", direction: "buy", vendor: "V008", label: "Hard vendor story", event: "AIS-E1-2026-00077", item: "AIS-E1-2026-00077-01", target: 250, limit: 280, blurb: "The same lunch order, but with a vendor whose history says it is hard to crack: a long conversation with real tactics." },
  { key: "sell", direction: "sell", label: "Scrap story", event: "AIS-E1-2026-00088", item: "AIS-E1-2026-00088-01", target: 170, limit: 165, blurb: "Selling an aluminium scrap lot: we want a higher price per kg." },
];

type Step = { title: string; short: string; what: string; why: string };

const STEPS: Step[] = [
  { title: "An event arrives", short: "Event", what: "A shopping cart (to buy) or a scrap lot (to sell) arrives from SAP. The buyer sees what is needed, how much, and which vendors are invited.", why: "Everything starts from a real requirement, nothing is typed in twice." },
  { title: "The buyer sets the goals", short: "Goals", what: "The buyer decides the price they hope for (target) and the point beyond which they will not go (walk-away limit). The limit is never shown to a vendor.", why: "The buyer stays in control: the negotiation can never go beyond what they decided." },
  { title: "Vendors respond", short: "Responses", what: "Invited vendors confirm and send their quotes (or bids for scrap), each in their own language and with their own payment terms.", why: "All offers land in one place, compared on the same footing." },
  { title: "Compare and analyse", short: "Compare", what: "The quotes are put side by side, adjusted for payment days, delivery, warranty and freight so unlike offers can be compared fairly. The gap to the goal shows the opportunity.", why: "The buyer sees at a glance how much is on the table before spending any effort." },
  { title: "Start the negotiation", short: "Start", what: "The buyer chooses who to negotiate with and how much runs on its own: fully automatic, approve each message, or manual. Nothing starts without the buyer.", why: "Speed where it is safe, a human in the loop where it matters." },
  { title: "The conversation", short: "Negotiate", what: "Messages go back and forth like a person-to-person chat: a first pushback, small steps, reasons, and everyday questions about delivery and payment. A person can stop it and take over at any moment.", why: "Real negotiation behaviour, with the buyer's limit enforced on every message." },
  { title: "Result", short: "Result", what: "The vendor agrees. The buyer sees the agreed price, the terms and the saving (or extra income), and decides to accept or push for more.", why: "A clear, defensible outcome with the numbers next to it." },
  { title: "Approval", short: "Approve", what: "The buyer reviews the deal with the counterparty, terms, conversation and price history, then approves and closes it.", why: "A formal decision point with the full evidence in one place." },
  { title: "Closed and handed over", short: "Done", what: "The event closes and the savings show on the dashboard. Purchase events export to the SAP Shopping Cart template; scrap sales export a deal summary.", why: "The result flows back into the systems the business already uses." },
];

function stepFor(state: ItemDetail["item"]["state"], started: boolean): number {
  switch (state) {
    case "draft":
      return started ? 1 : 0;
    case "points_reviewed":
    case "awaiting_bids":
      return 2;
    case "bids_in":
      return 3;
    case "analyzed":
      return 4;
    case "negotiating":
      return 5;
    case "result_pending":
      return 6;
    case "awaiting_approval":
      return 7;
    default:
      return 8; // closed, handed_back
  }
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function StoryPage() {
  const [sc, setSc] = useState<Scenario>(SCENARIOS[0]);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [eventClosed, setEventClosed] = useState(false);
  const stop = useRef(false);

  const refresh = useCallback(async () => {
    const d = await api.item(sc.item);
    setDetail(d);
    const list = await api.sessionsForItem(sc.item);
    const last = list[list.length - 1];
    setSession(last ? await api.session(last.id) : null);
    const ev = await api.event(sc.event);
    setEventClosed(ev.event.status === "closed");
    return d;
  }, [sc]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setViewing(null);
    refresh()
      .then((d) => live && setStarted(d.item.state !== "draft"))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [refresh]);

  const current = detail ? stepFor(detail.item.state, started) : 0;
  const shown = viewing ?? current;
  const d = detail?.event.direction ?? sc.direction;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      const fresh = await refresh();
      setViewing(null);
      return fresh;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The conversation plays by itself, one round at a time, until the vendor agrees or the viewer stops it.
  useEffect(() => {
    if (!playing || !session || session.status !== "active" || session.mode !== "auto") return;
    stop.current = false;
    let cancelled = false;
    setTyping(`${session.vendor_name} is typing`);
    const t = setTimeout(async () => {
      if (cancelled || stop.current) return;
      try {
        const next = await api.advance(session.id);
        if (!cancelled) {
          setSession(next);
          if (next.status !== "active") {
            setPlaying(false);
            await refresh();
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPlaying(false);
        }
      } finally {
        if (!cancelled) setTyping(null);
      }
    }, 1500 + Math.floor(Math.random() * 1200));
    return () => {
      cancelled = true;
      clearTimeout(t);
      setTyping(null);
    };
  }, [playing, session, refresh]);

  const startStory = () =>
    run(async () => {
      await api.reset();
      setStarted(true);
    });

  const finishEvent = () =>
    run(async () => {
      const ev = await api.event(sc.event);
      for (const it of ev.items) {
        if (it.id === sc.item || it.state === "closed" || it.state === "awaiting_approval") continue;
        // The other items use the buyer's suggested goals and simply take the best quote.
        if (it.state === "draft") {
          await api.setPoints(it.id, { target: it.target, limit: it.limit });
          await api.confirmPoints(it.id);
        }
        if (it.state === "draft" || it.state === "points_reviewed" || it.state === "awaiting_bids") await api.releaseBids(it.id);
        const mid = await api.item(it.id);
        if (mid.item.state === "bids_in") await api.analyze(it.id);
        await api.acceptDeal(it.id);
      }
      await api.approveEvent(sc.event);
    });

  const action: { label: string; onClick: () => void } | null = !detail
    ? null
    : shown !== current
      ? null
      : current === 0
        ? { label: "Start the story", onClick: () => void startStory() }
        : current === 1
          ? { label: `Set target ${money(sc.target)} and ${limitLabel(d).toLowerCase()} ${money(sc.limit)}`, onClick: () => void run(async () => { await api.setPoints(sc.item, { target: sc.target, limit: sc.limit }); await api.confirmPoints(sc.item); }) }
          : current === 2
            ? { label: "Collect the vendor responses", onClick: () => void run(() => api.releaseBids(sc.item)) }
            : current === 3
              ? { label: "Analyse the quotes", onClick: () => void run(() => api.analyze(sc.item)) }
              : current === 4
                ? { label: "Start negotiation (fully automatic)", onClick: () => void run(async () => { const s = await api.startNegotiation(sc.item, { mode: "auto", vendor_id: sc.vendor ?? null }); setSession(s); setPlaying(true); }) }
                : current === 6
                  ? { label: "Accept the deal", onClick: () => void run(() => api.acceptDeal(sc.item)) }
                  : current === 7
                    ? { label: "Approve and close", onClick: () => void run(() => api.approveEvent(sc.event)) }
                    : current === 8 && !eventClosed
                      ? { label: "Close the rest of the event", onClick: () => void finishEvent() }
                      : null;

  // Entering the conversation step by reload or navigation resumes the live play.
  useEffect(() => {
    if (current === 5 && session?.status === "active" && session.mode === "auto" && !playing) setPlaying(true);
  }, [current, session, playing]);

  const item = detail?.item;
  const o = session;

  const right = (): ReactNode => {
    if (!detail || !item) return null;
    switch (shown) {
      case 0:
        return (
          <Panel title="The event">
            <Facts rows={[["Event", `${detail.event.id} · ${detail.event.title}`], ["Type", <DirectionBadge key="t" direction={d} />], ["Item", item.description], ["Quantity", `${num(item.qty)} ${item.unit}`], ["Reference price", `${money(item.reference_price)} per ${item.unit}`], ["Vendors invited", String(detail.invitees.length)], ["Requested by", detail.event.requestor]]} />
          </Panel>
        );
      case 1:
        return (
          <Panel title="Negotiation goals">
            <Facts rows={[["Target price", `${money(item.target)} per ${item.unit}`], [limitLabel(d), `${money(item.limit)} per ${item.unit}`], ["Visible to vendors", "Neither number"]]} />
          </Panel>
        );
      case 2:
        return (
          <Panel title="Invited vendors">
            <ul className="grid gap-2 text-sm">
              {detail.invitees.map((v) => (
                <li key={v.vendor_id} className="flex items-center justify-between gap-3 rounded-m border border-line2 px-3 py-2">
                  <span className="font-semibold text-ink">{v.vendor_name}</span>
                  <Pill tone={v.responded ? "ok" : "muted"}>{v.responded ? `Quoted ${money(detail.comparison.rows.find((r) => r.vendor_id === v.vendor_id)?.unit_price)}` : "Invited"}</Pill>
                </li>
              ))}
            </ul>
          </Panel>
        );
      case 3:
        return detail.comparison.rows.length ? (
          <Panel title="Quote comparison">
            <ComparisonMatrix view={detail.comparison} direction={d} unit={item.unit} />
          </Panel>
        ) : (
          <Notice tone="info">Collect the vendor responses first to see the comparison.</Notice>
        );
      case 4:
        return (
          <div className="grid gap-4">
          {sc.vendor && detail.invitees.find((v) => v.vendor_id === sc.vendor) && (
            <Notice tone="red">
              <b>{detail.invitees.find((v) => v.vendor_id === sc.vendor)!.vendor_name}.</b> {detail.invitees.find((v) => v.vendor_id === sc.vendor)!.toughness.note}
            </Notice>
          )}
          <Panel title="Opportunity">
            <Facts rows={[[`Best ${quoteLabel(d).toLowerCase()}`, money(item.best_bid)], ["Target", money(item.target)], [limitLabel(d), money(item.limit)], ["Gap per unit", money(item.gap)], [`Potential ${deltaLabel(d).toLowerCase()}`, <Delta key="p" value={item.potential_delta} direction={d} />]]} />
          </Panel>
          </div>
        );
      case 5:
        return (
          <div className="grid gap-4">
          <Panel
            title={o ? `Conversation with ${o.vendor_name}` : "Conversation"}
            actions={
              playing ? (
                <Button size="sm" variant="danger" onClick={() => { stop.current = true; setPlaying(false); if (o) void api.setMode(o.id, "manual").then(setSession); }}>
                  Stop and take over
                </Button>
              ) : o ? (
                <Link href={`/negotiate/${o.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">Open workspace</Link>
              ) : undefined
            }
          >
            {o ? (
              <div className="max-h-[28rem] overflow-auto pr-1">
                <ChatLog turns={o.turns} typing={typing} vendorName={o.vendor_name} />
              </div>
            ) : (
              <p className="text-sm text-muted">The conversation appears here once the negotiation starts.</p>
            )}
          </Panel>
          {o && <StrategyPanel strategy={o.strategy} />}
          </div>
        );
      default: {
        if (!o) return <Notice tone="info">Nothing to show for this step yet.</Notice>;
        return (
          <Panel title={shown === 8 ? "Outcome" : shown === 7 ? "Deal for approval" : "Agreed result"}>
            <Facts
              rows={[
                ["Counterparty", o.vendor_name],
                [`Original ${quoteLabel(d).toLowerCase()}`, `${money(o.original_price)} per ${item.unit}`],
                ["Final price", `${money(o.agreed_price)} per ${item.unit}`],
                ["Payment terms", o.agreed_payment ?? "—"],
                ["Value at final price", money(o.agreed_value)],
                [deltaLabel(d), <Delta key="d" value={o.agreed_delta} direction={d} label />],
                ["Rounds", String(o.round)],
              ]}
            />
          </Panel>
        );
      }
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-m border border-line bg-raise p-0.5" role="group" aria-label="Choose a story">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sc.key === s.key}
              onClick={() => { setSc(s); setPlaying(false); }}
              className={`rounded-chip px-4 py-2 text-sm font-semibold transition ${sc.key === s.key ? "bg-panel text-brand shadow-card" : "text-muted hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 text-sm text-muted">{sc.blurb}</p>
        <Button disabled={busy} onClick={() => void startStory()}>
          <Icon name="history" size={15} /> Restart story
        </Button>
      </div>

      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9" aria-label="Story steps">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === shown;
          return (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setViewing(i === current ? null : i)}
                aria-current={i === current ? "step" : undefined}
                className={`flex w-full flex-col items-center gap-1.5 rounded-card border px-2 py-3 text-center text-xs font-semibold transition ${active ? "border-brand bg-brand-soft text-ink" : "border-line bg-panel text-muted hover:border-brand"}`}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${done ? "bg-ok text-white" : i === current ? "bg-brand text-on-brand" : "bg-raise text-muted"}`}>
                  {done ? <Icon name="check" size={14} /> : i + 1}
                </span>
                {s.short}
              </button>
            </li>
          );
        })}
      </ol>

      {error && <ErrorBox message={error} status={null} onRetry={() => void refresh()} />}
      {loading && !detail && <Loading label="Loading the story" />}

      {detail && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Panel title={`Step ${shown + 1} of ${STEPS.length}: ${STEPS[shown].title}`}>
            <div className="grid gap-4 text-sm">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted">What happens</div>
                <p className="mt-1 text-text">{STEPS[shown].what}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted">Why it matters</div>
                <p className="mt-1 text-text">{STEPS[shown].why}</p>
              </div>
              {shown === 5 && session?.status === "agreed" && <Notice tone="ok">Agreed at {money(session.agreed_price)} per {item?.unit}. Move on to see the result.</Notice>}
              {shown === 8 && (
                <div className="grid gap-2">
                  {eventClosed ? (
                    <>
                      <a href={api.exportUrl(sc.event)} download className="inline-flex items-center justify-center gap-2 rounded-m border border-line bg-panel px-4 py-2 font-semibold text-ink hover:border-brand">
                        <Icon name="download" size={16} /> {sc.direction === "buy" ? "Download Shopping Cart template (CSV)" : "Download deal summary (CSV)"}
                      </a>
                      <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-m bg-brand px-4 py-2 font-semibold text-on-brand">
                        <Icon name="dashboard" size={16} /> See it on the dashboard
                      </Link>
                    </>
                  ) : (
                    <Notice tone="info">The other items of this event still need a decision before it can close and export.</Notice>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line2 pt-4">
                {action ? (
                  <Button variant="primary" disabled={busy || playing} onClick={action.onClick}>
                    {busy ? "Working…" : action.label}
                  </Button>
                ) : shown !== current ? (
                  <Button onClick={() => setViewing(null)}>Back to the current step</Button>
                ) : null}
                <span className="ml-auto flex gap-2">
                  <Button size="sm" disabled={shown <= 0} onClick={() => setViewing(shown - 1)} aria-label="Previous step">
                    <Icon name="back" size={14} /> Back
                  </Button>
                  <Button size="sm" disabled={shown >= current} onClick={() => setViewing(shown + 1 >= current ? null : shown + 1)} aria-label="Next step">
                    Next <Icon name="chevron" size={14} />
                  </Button>
                </span>
              </div>
            </div>
          </Panel>
          <div className="min-w-0">{right()}</div>
        </div>
      )}
    </div>
  );
}
