"use client";

import Link from "next/link";
import { useState } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { HistoryTab } from "@/components/item/HistoryTab";
import { Pill } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading } from "@/components/ui/State";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import { api, type ItemDetail } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, STATE_LABEL, STATE_TONE, limitLabel, quoteLabel } from "@/lib/labels";

type Tab = "details" | "compare" | "history";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-m border border-line2 bg-raise px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold text-ink tabular-nums">{children}</div>
    </div>
  );
}

function Details({ detail }: { detail: ItemDetail }) {
  const { item, event } = detail;
  const d = event.direction;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        {event.title} · {event.category}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Quantity">{num(item.qty)} {item.unit}</Fact>
        <Fact label="Reference price">{money(item.reference_price)}</Fact>
        <Fact label="Total value">{money(item.value)}</Fact>
        <Fact label="Target">{money(item.target)}</Fact>
        <Fact label={limitLabel(d)}>{money(item.limit)}</Fact>
        <Fact label={`Best ${quoteLabel(d).toLowerCase()}`}>
          {item.best_bid == null ? "—" : `${money(item.best_bid)}${item.best_bid_vendor ? ` · ${item.best_bid_vendor}` : ""}`}
        </Fact>
        <Fact label="Incoterm">{item.incoterm}</Fact>
        <Fact label="Delivery">{item.delivery_days} days</Fact>
        <Fact label={d === "buy" ? "Quotes" : "Bids"}>{item.bid_count} from {detail.invitees.length} invited</Fact>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Pill>
        <Pill tone={RECOMMENDATION_TONE[item.recommendation]}>{RECOMMENDATION_LABEL[item.recommendation]}</Pill>
      </div>
    </div>
  );
}

function Content({ itemId }: { itemId: string }) {
  const [tab, setTab] = useState<Tab>("details");
  const { data, error, errorStatus, loading, reload } = useApi(() => api.item(itemId), [itemId]);
  if (loading && !data) return <Loading label="Loading item" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="grid gap-4">
      <Tabs
        idPrefix="quick"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "details", label: "Details" },
          { key: "compare", label: "Compare vendors" },
          { key: "history", label: "Price history" },
        ]}
      />
      <div role="tabpanel" id={panelId("quick", tab)} aria-labelledby={tabId("quick", tab)}>
        {tab === "details" ? (
          <Details detail={data} />
        ) : tab === "compare" ? (
          data.comparison.rows.length === 0 ? (
            <p className="text-sm text-muted">No quotes yet, so there is nothing to compare.</p>
          ) : (
            <ComparisonMatrix view={data.comparison} direction={data.event.direction} unit={data.item.unit} />
          )
        ) : (
          <HistoryTab detail={data} />
        )}
      </div>
    </div>
  );
}

/** A quick look at one item from the event's item list: details, vendor comparison and past prices, without leaving the page. */
export function ItemQuickView({ itemId, title, open, onClose }: { itemId: string; title: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      title={title}
      size="xl"
      onClose={onClose}
      footer={
        <Link href={`/items/${itemId}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">
          Open full item page
        </Link>
      }
    >
      {open && <Content itemId={itemId} />}
    </Dialog>
  );
}
