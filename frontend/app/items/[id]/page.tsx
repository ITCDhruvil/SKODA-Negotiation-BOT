"use client";

import Link from "next/link";
import { ToughnessBadge } from "@/components/negotiation/ToughnessBadge";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { HistoryTab } from "@/components/item/HistoryTab";
import { NegotiationTab } from "@/components/item/NegotiationTab";
import { NextStep } from "@/components/item/NextStep";
import { StartNegotiationTab } from "@/components/item/StartNegotiationTab";
import { LiveConversationsTab } from "@/components/item/LiveConversationsTab";
import { CompareResultsTab } from "@/components/item/CompareResultsTab";
import { useLiveSessions } from "@/components/item/useLiveSessions";
import { SupplierDialog } from "@/components/item/SupplierDialog";
import { HandlingCard } from "@/components/item/HandlingCard";
import { Stepper } from "@/components/item/Stepper";
import { Button, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { api, type ItemDetail, type SessionSummary } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { BAND_LABEL, BAND_TONE, TOUGH_LABEL, TOUGH_TONE, SESSION_LABEL, SESSION_TONE, STATE_LABEL, STATE_TONE, deltaLabel, partyLabel, quoteLabel, quotesLabel } from "@/lib/labels";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };
const VENDOR_STATUS = ["Invited", "Quoted", "In progress", "Agreed", "Handed back"];

type VendorRow = {
  invitee: ItemDetail["invitees"][number];
  quote: ItemDetail["comparison"]["rows"][number] | undefined;
  last: SessionSummary | undefined;
  status: string;
};

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

  // One row per invited vendor: its quote (if any) and the state of any conversation with it.
  const [vq, setVq] = useState("");
  const [vRating, setVRating] = useState("");
  const [vLang, setVLang] = useState("");
  const [vStatus, setVStatus] = useState("");
  const allRows: VendorRow[] = invitees.map((v) => {
    const quote = comparison.rows.find((r) => r.vendor_id === v.vendor_id);
    const mine = sessions.filter((x) => x.vendor_id === v.vendor_id);
    const last = mine[mine.length - 1];
    const status = last ? SESSION_LABEL[last.status] : v.responded ? "Quoted" : "Invited";
    return { invitee: v, quote, last, status };
  });
  const vendorRows = allRows.filter(
    (r) =>
      (!vq || r.invitee.vendor_name.toLowerCase().includes(vq.toLowerCase())) &&
      (!vRating || r.invitee.rating >= Number(vRating)) &&
      (!vLang || r.invitee.language === vLang) &&
      (!vStatus || r.status === vStatus),
  );
  const vendorColumns: Column<VendorRow>[] = [
    {
      key: "vendor",
      header: "Vendor",
      sort: (r) => r.invitee.vendor_name.toLowerCase(),
      cell: (r) => (
        <Link href={`/vendors/${r.invitee.vendor_id}`} className="font-semibold text-ink hover:text-brand hover:underline">
          {r.invitee.vendor_name}
        </Link>
      ),
    },
    { key: "rating", header: "Rating", align: "center", className: "w-[1%]", sort: (r) => r.invitee.rating, cell: (r) => <span className="tabular-nums">{r.invitee.rating.toFixed(1)}</span> },
    {
      key: "tough",
      header: "Negotiates",
      align: "center",
      className: "w-[1%]",
      sort: (r) => ["hard", "firm", "unknown", "flexible"].indexOf(r.invitee.toughness.level),
      cell: (r) => (
        <ToughnessBadge vendorName={r.invitee.vendor_name} toughness={r.invitee.toughness} showUnknown />
      ),
    },
    { key: "lang", header: "Language", align: "center", className: "w-[1%]", sort: (r) => r.invitee.language, cell: (r) => LANG[r.invitee.language] ?? r.invitee.language },
    {
      key: "quote",
      header: "Quote",
      align: "right",
      className: "w-[1%]",
      sort: (r) => r.quote?.unit_price,
      cell: (r) => (r.quote ? <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{money(r.quote.unit_price)} · {r.quote.payment_code}</span> : <span className="text-muted">—</span>),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      className: "w-[1%]",
      sort: (r) => r.status,
      cell: (r) => (r.last ? <Pill tone={SESSION_TONE[r.last.status]}>{r.status}</Pill> : <Pill tone={r.invitee.responded ? "ok" : "muted"}>{r.status}</Pill>),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      className: "w-[1%] whitespace-nowrap",
      cell: (r) =>
        r.last ? (
          <Button size="sm" onClick={onShowNegotiation}>
            <Icon name="chat" size={14} /> Conversation
          </Button>
        ) : !r.invitee.responded && canCollect ? (
          <Button size="sm" disabled={busy} onClick={() => setInviting(r.invitee.vendor_id)}>
            <Icon name="plus" size={14} /> Get quote
          </Button>
        ) : null,
    },
  ];

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

      <div id="vendors-panel" className="scroll-mt-4">
      <Panel
        title="Vendors on this item"
        flush
      >
        <TableToolbar
          search={{ value: vq, onChange: setVq, placeholder: "Search vendors" }}
          filters={[
            {
              key: "rating",
              label: "Rating",
              value: vRating,
              onChange: setVRating,
              options: [{ value: "", label: "Any rating" }, { value: "4.5", label: "4.5 and above" }, { value: "4", label: "4.0 and above" }, { value: "3.5", label: "3.5 and above" }],
            },
            {
              key: "language",
              label: "Language",
              value: vLang,
              onChange: setVLang,
              options: [{ value: "", label: "All" }, ...Object.entries(LANG).map(([value, label]) => ({ value, label }))],
            },
            {
              key: "status",
              label: "Status",
              value: vStatus,
              onChange: setVStatus,
              options: [{ value: "", label: "All" }, ...VENDOR_STATUS.map((x) => ({ value: x, label: x }))],
            },
          ]}
          right={<span>{vendorRows.length} of {invitees.length} vendors</span>}
        />
        <DataTable
          columns={vendorColumns}
          rows={vendorRows}
          rowKey={(r) => r.invitee.vendor_id}
          empty={invitees.length === 0 ? "No vendors invited for this item." : "No vendors match."}
        />
        {(item.state === "draft" || item.state === "points_reviewed" || item.state === "awaiting_bids") && (
          <p className="border-t border-line2 px-5 py-3 text-xs text-muted">
            These are the vendors invited when the event was created (chosen by category, rating and past dealings). In this demo their
            quotes are simulated: &ldquo;Get quote&rdquo; makes a vendor reply with its quote.
          </p>
        )}
        {showFooter && (
          <div className="grid gap-3 border-t border-line2 px-5 py-4">
            {item.state === "draft" && (
              <>
                <Notice tone="info">Confirm your negotiation points first. Vendors are invited once the points are confirmed.</Notice>
                {invitees.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          if (item.target != null && item.limit != null) await api.setPoints(item.id, { target: item.target, limit: item.limit });
                          await api.confirmPoints(item.id);
                          await api.releaseBids(item.id);
                        })
                      }
                    >
                      Confirm points and get all quotes
                    </Button>
                    <span className="text-xs text-muted">Demo shortcut: uses the suggested points ({money(item.target)} target, {money(item.limit)} limit) and makes every invited vendor reply.</span>
                  </div>
                )}
              </>
            )}
            {noneAvailable && (
              <Notice tone="amber">
                Every invited vendor has responded and there are no more vendors available to invite for this item
                {detail.bids_eligibility.eligible ? "." : `, so it cannot continue: ${detail.bids_eligibility.reason}.`}
              </Notice>
            )}
            {canCollect && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={busy} onClick={() => act(() => api.releaseBids(item.id))}>
                  Get all quotes
                </Button>
                <span className="text-xs text-muted">
                  Or use &ldquo;Get quote&rdquo; for each vendor in the list above.
                </span>
              </div>
            )}
          </div>
        )}
      </Panel>
      </div>
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
    <Panel title="Outcome" actions={<Link href={`/events/${detail.event.id}/contract`} className="text-xs font-semibold text-brand hover:underline">View contract</Link>}>
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
  // The row menu on the event page links here with ?tab=quotes|negotiation|history to land on that tab.
  const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
  type TabKey = "quotes" | "start" | "negotiation" | "compare" | "history";
  const requested: TabKey | null = asked === "quotes" || asked === "start" || asked === "negotiation" || asked === "compare" || asked === "history" ? asked : null;
  // An item opens on its vendors and quotes, the first step of the flow; the next steps are the tabs to its right.
  const [tab, setTab] = useState<TabKey>(requested ?? "quotes");
  const { views: live, update: updateLive, watch: watchLive } = useLiveSessions(list, tab === "negotiation" || tab === "compare", () => {
    void reload();
    void reloadSessions();
  });
  const pick = (t: TabKey) => {
    setTab(t);
  };
  // After the quotes are analysed nothing in the main area changes, so point at the card where the next step happens.
  const [note, setNote] = useState<string | null>(null);
  const goStart = useCallback(() => {
    pick("start");
    setTimeout(() => document.getElementById("item-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const previous = useRef(item.state);
  useEffect(() => {
    if (previous.current === "bids_in" && item.state === "analyzed") {
      setNote("Quotes analysed. Next: open the Start negotiation tab, choose the vendors and begin.");
      setTimeout(goStart, 150);
      setTimeout(() => setNote(null), 9000);
    }
    previous.current = item.state;
  }, [item.state, goStart]);
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
            <Pill tone={BAND_TONE[item.policy.band]}>{BAND_LABEL[item.policy.band]}</Pill>
          </span>
        }
        subtitle={`${event.title} · ${num(item.qty)} ${item.unit} · reference ${money(item.reference_price)} per ${item.unit} · ${item.incoterm}`}
      />
      <div className="mb-5 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-card border border-line bg-panel px-5 py-4 shadow-card">
        <Stepper state={item.state} />
        <NextStep
          detail={detail}
          sessions={list}
          onOpenVendors={() => {
            pick("quotes");
            // Wait for the tab to render, then bring the vendor list into view and focus its first action.
            setTimeout(() => {
              const panel = document.getElementById("vendors-panel");
              panel?.scrollIntoView({ behavior: "smooth", block: "center" });
              panel?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
            }, 50);
          }}
          onOpenOpportunity={goStart}
          onChanged={async () => {
            await reload();
            await reloadSessions();
          }}
        />
      </div>
        <HandlingCard policy={item.policy} offers={item.bid_count} className="h-full" />
      </div>
      {note && (
        <div className="mb-4">
          <Notice tone="ok">{note}</Notice>
        </div>
      )}
      {!event.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">Not eligible for negotiation: {event.eligibility.reason}.</Notice>
        </div>
      )}
      <div className="grid items-start gap-5">
        <ItemActions detail={detail} onChanged={reload} />
        <OutcomePanel detail={detail} />
        <Panel flush className="min-w-0">
          <span id="item-tabs" className="block scroll-mt-4" />
          <div className="px-5">
            <Tabs
              idPrefix="item"
              value={tab}
              onChange={pick}
              tabs={[
                { key: "quotes", label: `Vendors & ${quotesLabel(event.direction).toLowerCase()}` },
                { key: "start", label: "Start negotiation" },
                { key: "negotiation", label: `Conversations${list.length ? ` (${list.length})` : ""}` },
                { key: "compare", label: "Compare results" },
                { key: "history", label: "Price history" },
              ]}
            />
          </div>
          <div className="p-5" role="tabpanel" id={panelId("item", tab)} aria-labelledby={tabId("item", tab)}>
            {tab === "quotes" ? (
              <QuotesTab detail={detail} sessions={list} onChanged={reload} onShowNegotiation={() => pick("negotiation")} />
            ) : tab === "start" ? (
              <StartNegotiationTab
                detail={detail}
                sessions={list}
                onChanged={async () => {
                  await reload();
                  await reloadSessions();
                }}
                onStarted={() => pick("negotiation")}
              />
            ) : tab === "negotiation" ? (
              <LiveConversationsTab sessions={list} views={live} onUpdate={updateLive} onWatch={watchLive} onStartMore={() => pick("start")} onChanged={() => void reload()} />
            ) : tab === "compare" ? (
              <CompareResultsTab
                detail={detail}
                sessions={list}
                views={live}
                onChanged={async () => {
                  await reload();
                  await reloadSessions();
                }}
                onStart={() => pick("start")}
              />
            ) : (
              <HistoryTab detail={detail} />
            )}
          </div>
        </Panel>
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
