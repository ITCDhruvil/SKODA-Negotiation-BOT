"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { HistoryTab } from "@/components/item/HistoryTab";
import { NegotiationTab } from "@/components/item/NegotiationTab";
import { NextStep } from "@/components/item/NextStep";
import { OpportunityPanel } from "@/components/item/OpportunityPanel";
import { SupplierDialog } from "@/components/item/SupplierDialog";
import { PointsPanel } from "@/components/item/PointsPanel";
import { Stepper } from "@/components/item/Stepper";
import { Button, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { api, type ItemDetail, type SessionSummary } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { SESSION_LABEL, SESSION_TONE, STATE_LABEL, STATE_TONE, deltaLabel, partyLabel, quoteLabel, quotesLabel } from "@/lib/labels";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

function QuotesTab({
  detail,
  sessions,
  onChanged,
  onShowNegotiation,
}: {
  detail: ItemDetail;
  sessions: SessionSummary[];
  onChanged: () => Promise<void>;
  onShowNegotiation: () => void;
}) {
  const { item, event, invitees, comparison } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const pending = invitees.filter((i) => !i.responded);
  const canCollect = (item.state === "points_reviewed" || item.state === "awaiting_bids") && pending.length > 0;
  const noneAvailable = item.state === "awaiting_bids" && pending.length === 0;
  const showFooter = item.state === "draft" || noneAvailable || canCollect;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      {error && <Notice tone="red">{error}</Notice>}

      {comparison.rows.length > 0 && (
        <>
          <ComparisonMatrix view={comparison} direction={event.direction} unit={item.unit} />
          {item.state === "bids_in" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={busy} onClick={() => act(() => api.analyze(item.id))}>
                Analyze quotes
              </Button>
              <span className="text-xs text-muted">Marks the comparison as reviewed and shows the negotiation opportunity.</span>
            </div>
          )}
          {item.state === "awaiting_bids" && pending.length > 0 && (
            <Notice tone="amber">
              {detail.bids_eligibility.reason || `${item.bid_count} ${quotesLabel(event.direction).toLowerCase()} in`}.
              Collect more vendor responses to continue.
            </Notice>
          )}
        </>
      )}

      <Panel
        title="Vendors on this item"
        subtitle={`${partyLabel(event.direction)}s invited to ${quoteLabel(event.direction).toLowerCase()}. ${invitees.filter((i) => i.responded).length} of ${invitees.length} responded.`}
        flush
      >
        <ul className="divide-y divide-line2">
          {invitees.map((v) => (
            <li key={v.vendor_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Link href={`/vendors/${v.vendor_id}`} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline">
                {v.vendor_name}
              </Link>
              <span className="text-muted">Rating {v.rating.toFixed(1)}</span>
              <span className="text-muted">{LANG[v.language] ?? v.language}</span>
              {(() => {
                const quote = comparison.rows.find((r) => r.vendor_id === v.vendor_id);
                const mine = sessions.filter((x) => x.vendor_id === v.vendor_id);
                const last = mine[mine.length - 1];
                return (
                  <>
                    {quote && (
                      <span className="font-semibold tabular-nums text-ink">
                        {money(quote.unit_price)} · {quote.payment_code}
                      </span>
                    )}
                    {last ? (
                      <Pill tone={SESSION_TONE[last.status]}>{SESSION_LABEL[last.status]}</Pill>
                    ) : (
                      <Pill tone={v.responded ? "ok" : "muted"}>{v.responded ? "Quoted" : "Invited"}</Pill>
                    )}
                    {last && (
                      <Button size="sm" onClick={onShowNegotiation}>
                        Conversation
                      </Button>
                    )}
                  </>
                );
              })()}
              {!v.responded && canCollect && (
                <Button size="sm" disabled={busy} onClick={() => setInviting(v.vendor_id)}>
                  Simulate response
                </Button>
              )}
            </li>
          ))}
          {invitees.length === 0 && <li className="px-5 py-6 text-sm text-muted">No vendors invited for this item.</li>}
        </ul>
        {showFooter && (
          <div className="grid gap-3 border-t border-line2 px-5 py-4">
            {item.state === "draft" && <Notice tone="info">Confirm your negotiation points first. Vendors are invited once the points are confirmed.</Notice>}
            {noneAvailable && (
              <Notice tone="amber">
                Every invited vendor has responded and there are no more vendors available to invite for this item
                {detail.bids_eligibility.eligible ? "." : `, so it cannot continue: ${detail.bids_eligibility.reason}.`}
              </Notice>
            )}
            {canCollect && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={busy} onClick={() => act(() => api.releaseBids(item.id))}>
                  Load all scripted replies (demo)
                </Button>
                <span className="text-xs text-muted">
                  Or simulate each supplier above: invite, consent and one-time code are mocked on screen only.
                </span>
              </div>
            )}
          </div>
        )}
      </Panel>
      <SupplierDialog
        vendor={invitees.find((v) => v.vendor_id === inviting) ?? null}
        direction={event.direction}
        onClose={() => setInviting(null)}
        onConfirmed={async (vid) => {
          await api.releaseBids(item.id, [vid]);
          await onChanged();
        }}
      />
    </div>
  );
}

function ItemActions({ detail, onChanged }: { detail: ItemDetail; onChanged: () => Promise<void> }) {
  const { item } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAccept = item.state === "analyzed" && item.within_limit === true;
  const canClose = item.state === "handed_back";
  const awaiting = item.state === "awaiting_approval";
  if (!canAccept && !canClose && !awaiting) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Other actions">
      <div className="grid gap-2">
        {error && <Notice tone="red">{error}</Notice>}
        {canAccept && (
          <Button disabled={busy} onClick={() => act(() => api.acceptDeal(item.id))}>
            Accept best quote as it stands
          </Button>
        )}
        {canClose && (
          <Button variant="danger" disabled={busy} onClick={() => act(() => api.closeWithoutDeal(item.id))}>
            Close without a deal
          </Button>
        )}
        {awaiting && (
          <Link href={`/events/${detail.event.id}/approve`} className="rounded-m border border-line bg-panel px-4 py-2 text-center text-sm font-semibold text-ink hover:border-brand">
            Review & approve
          </Link>
        )}
      </div>
    </Panel>
  );
}

function OutcomePanel({ detail }: { detail: ItemDetail }) {
  const o = detail.outcome;
  if (!o) return null;
  const d = detail.event.direction;
  return (
    <Panel title="Outcome" subtitle={o.negotiated ? "Negotiated deal" : `Accepted at the best ${quoteLabel(d).toLowerCase()}`}>
      <dl className="grid gap-2 text-sm">
        {[
          ["Vendor", o.vendor_name],
          [`Original ${quoteLabel(d).toLowerCase()}`, money(o.original_price)],
          ["Final price", money(o.final_price)],
          ["Quantity", `${num(o.qty)} ${detail.item.unit}`],
          [deltaLabel(d), money(o.value_delta)],
          ["Terms", `${o.payment_code} · ${o.incoterm}`],
          ["Closed", `${dateShort(o.closed_date)} · ${o.duration_minutes} min`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line2 pb-2 last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Body({ detail, reload }: { detail: ItemDetail; reload: () => Promise<void> }) {
  const { item, event } = detail;
  const { data: sessions, reload: reloadSessions } = useApi(() => api.sessionsForItem(item.id), [item.id, item.state]);
  const list = sessions ?? [];
  const [tab, setTab] = useState<"quotes" | "negotiation" | "history">(list.length > 0 ? "negotiation" : "quotes");
  const [chosen, setChosen] = useState(false);
  // Land on the conversation once there is one, unless the user already picked a tab.
  useEffect(() => {
    if (!chosen && list.length > 0) setTab("negotiation");
  }, [chosen, list.length]);
  const pick = (t: "quotes" | "negotiation" | "history") => {
    setChosen(true);
    setTab(t);
  };
  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/events" className="hover:underline">Events</Link> /{" "}
            <Link href={`/events/${event.id}`} className="hover:underline">{event.id}</Link> / {item.description}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {item.description}
            <DirectionBadge direction={event.direction} />
            <Pill tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Pill>
          </span>
        }
        subtitle={`${event.title} · ${num(item.qty)} ${item.unit} · reference ${money(item.reference_price)} per ${item.unit} · ${item.incoterm}`}
      />
      <div className="mb-5 rounded-l border border-line bg-panel px-5 py-4 shadow-card">
        <Stepper state={item.state} />
        <NextStep
          detail={detail}
          sessions={list}
          onOpenVendors={() => pick("quotes")}
          onChanged={async () => {
            await reload();
            await reloadSessions();
          }}
        />
      </div>
      {!event.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">Not eligible for negotiation: {event.eligibility.reason}.</Notice>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel flush className="min-w-0">
          <div className="px-5">
            <Tabs
              idPrefix="item"
              value={tab}
              onChange={pick}
              tabs={[
                { key: "quotes", label: `Vendors & ${quotesLabel(event.direction).toLowerCase()}` },
                { key: "negotiation", label: `Negotiation${list.length ? ` (${list.length})` : ""}` },
                { key: "history", label: "Price history" },
              ]}
            />
          </div>
          <div className="p-5" role="tabpanel" id={panelId("item", tab)} aria-labelledby={tabId("item", tab)}>
            {tab === "quotes" ? (
              <QuotesTab detail={detail} sessions={list} onChanged={reload} onShowNegotiation={() => pick("negotiation")} />
            ) : tab === "negotiation" ? (
              <NegotiationTab sessions={list} />
            ) : (
              <HistoryTab detail={detail} />
            )}
          </div>
        </Panel>
        <div className="grid content-start gap-5">
          <OpportunityPanel detail={detail} />
          <PointsPanel detail={detail} eventDirection={event.direction} onChanged={reload} />
          <ItemActions detail={detail} onChanged={reload} />
          <OutcomePanel detail={detail} />
        </div>
      </div>
    </>
  );
}

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.item(id), [id]);
  if (loading && !data) return <Loading label="Loading item" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  return (
    <>
      {error && (
        <div className="mb-4">
          <Notice tone="red">Could not refresh: {error}</Notice>
        </div>
      )}
      <Body detail={data} reload={reload} />
    </>
  );
}
