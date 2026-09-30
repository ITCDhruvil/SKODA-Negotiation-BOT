"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { HistoryTab } from "@/components/item/HistoryTab";
import { OpportunityPanel } from "@/components/item/OpportunityPanel";
import { PointsPanel } from "@/components/item/PointsPanel";
import { Stepper } from "@/components/item/Stepper";
import { Button, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { api, type ItemDetail } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { STATE_LABEL, STATE_TONE, deltaLabel, partyLabel, quoteLabel, quotesLabel } from "@/lib/labels";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

function QuotesTab({ detail, onChanged }: { detail: ItemDetail; onChanged: () => Promise<void> }) {
  const { item, event, invitees, comparison } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        title={comparison.rows.length === 0 ? "Vendor responses" : pending.length > 0 ? "Waiting for vendors" : "Vendors"}
        subtitle={`${partyLabel(event.direction)}s invited to ${quoteLabel(event.direction).toLowerCase()} on this item.`}
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
              <Pill tone={v.responded ? "ok" : "muted"}>{v.responded ? "Responded" : "Invited"}</Pill>
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
                  Collect vendor responses (demo)
                </Button>
                <span className="text-xs text-muted">
                  The supplier invite, consent and OTP flow arrives in the next release. For now this loads the scripted vendor replies.
                </span>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
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
  const [tab, setTab] = useState<"quotes" | "history">("quotes");
  const { item, event } = detail;
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
              onChange={setTab}
              tabs={[
                { key: "quotes", label: `${quotesLabel(event.direction)} & comparison` },
                { key: "history", label: "History" },
              ]}
            />
          </div>
          <div className="p-5" role="tabpanel" id={panelId("item", tab)} aria-labelledby={tabId("item", tab)}>
            {tab === "quotes" ? <QuotesTab detail={detail} onChanged={reload} /> : <HistoryTab detail={detail} />}
          </div>
        </Panel>
        <div className="grid content-start gap-5">
          <OpportunityPanel detail={detail} />
          <PointsPanel detail={detail} eventDirection={event.direction} onChanged={reload} />
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
