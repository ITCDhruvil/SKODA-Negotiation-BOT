"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { HistoryTab } from "@/components/item/HistoryTab";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { ChatLog } from "@/components/negotiation/ChatLog";
import { Delta, Panel, Pill } from "@/components/ui/basics";
import { Tabs, panelId, tabId } from "@/components/ui/Tabs";
import type { EventView, ItemDetail, SessionView, VendorView } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { MODE_LABEL, deltaLabel, partyLabel } from "@/lib/labels";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

export type ReviewEntry = { detail: ItemDetail; session: SessionView | null; vendor: VendorView | null };

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 last:border-0">
          <dt className="shrink-0 text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-right font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function duration(a: string, b: string | null): string {
  if (!b) return "In progress";
  const mins = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Tab = "summary" | "conversation" | "comparison" | "history";

export function ItemReview({ entry, event }: { entry: ReviewEntry; event: EventView }) {
  const { detail, session, vendor } = entry;
  const { item } = detail;
  const d = event.direction;
  const [tab, setTab] = useState<Tab>("summary");
  const vendorId = session?.vendor_id ?? item.best_bid_vendor_id ?? "";
  const quote = detail.comparison.rows.find((r) => r.vendor_id === vendorId);
  const finalPrice = session ? session.agreed_price : item.best_bid;
  const originalPrice = session ? session.original_price : item.best_bid;

  return (
    <Panel
      title={item.description}
      actions={
        <>
          <Pill tone={session ? "ok" : "info"}>{session ? "Negotiated" : "Best quote accepted as it stands"}</Pill>
          <Link href={`/items/${item.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
            Open item
          </Link>
        </>
      }
    >
      <div className="-mt-2 mb-4">
        <Tabs
          idPrefix="review"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "summary", label: "Summary" },
            { key: "conversation", label: `Conversation${session ? ` (${session.turns.length})` : ""}` },
            { key: "comparison", label: "Comparison" },
            { key: "history", label: "Price history" },
          ]}
        />
      </div>
      <div role="tabpanel" id={panelId("review", tab)} aria-labelledby={tabId("review", tab)}>
        {tab === "summary" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-m border border-line2 p-4">
              <h3 className="mb-1 text-sm font-bold text-ink">Sent to ({partyLabel(d).toLowerCase()})</h3>
              <Facts
                rows={[
                  ["Name", vendor ? <Link key="n" href={`/vendors/${vendor.id}`} className="text-brand hover:underline">{vendor.name}</Link> : (session?.vendor_name ?? item.best_bid_vendor ?? "—")],
                  ["SAP number", vendor?.sap_no ?? "—"],
                  ["Rating", vendor ? vendor.rating.toFixed(1) : "—"],
                  ["Preferred payment", vendor?.payment_pref ?? "—"],
                  ["Past deals", vendor ? String(vendor.past_deals) : "—"],
                  ["Categories", vendor ? vendor.categories.join(", ") || "—" : "—"],
                  ["Conversation language", LANG[session?.language ?? quote?.language ?? "en"]],
                ]}
              />
            </div>
            <div className="rounded-m border border-line2 p-4">
              <h3 className="mb-1 text-sm font-bold text-ink">Agreed terms</h3>
              <Facts
                rows={[
                  ["Quantity", `${num(item.qty)} ${item.unit}`],
                  [`Original ${d === "buy" ? "quote" : "bid"}`, `${money(originalPrice)} per ${item.unit}`],
                  ["Final price", `${money(finalPrice)} per ${item.unit}`],
                  ["Value at final price", money(session ? session.agreed_value : item.value)],
                  [deltaLabel(d), <Delta key="d" value={session ? session.agreed_delta : 0} direction={d} />],
                  ["Payment terms", session?.agreed_payment ?? quote?.payment_code ?? "—"],
                  ["Incoterm", quote?.incoterm ?? item.incoterm],
                  [d === "buy" ? "Delivery" : "Pickup", quote ? `${quote.delivery_days} days` : `${item.delivery_days} days`],
                  ["Offer valid for", quote ? `${quote.validity_days} days` : "—"],
                  ["Warranty", quote ? (quote.warranty_months ? `${quote.warranty_months} months` : "None") : "—"],
                ]}
              />
            </div>
            <div className="rounded-m border border-line2 p-4">
              <h3 className="mb-1 text-sm font-bold text-ink">Negotiation record</h3>
              {session ? (
                <Facts
                  rows={[
                    ["Permission level", MODE_LABEL[session.mode]],
                    ["Rounds", String(session.round)],
                    ["Messages", String(session.turns.length)],
                    ["Started", stamp(session.started_at)],
                    ["Ended", session.ended_at ? stamp(session.ended_at) : "—"],
                    ["Duration", duration(session.started_at, session.ended_at)],
                    ["Typed by a person", session.turns.some((t) => t.author === "human") ? "Yes" : "No"],
                  ]}
                />
              ) : (
                <p className="py-3 text-sm text-muted">The best {d === "buy" ? "quote" : "bid"} was accepted without a negotiation.</p>
              )}
            </div>
            <div className="rounded-m border border-line2 p-4">
              <h3 className="mb-1 text-sm font-bold text-ink">Event details</h3>
              <Facts
                rows={[
                  ["Event", `${event.id} · ${event.category.replace(/^\d+ - /, "")}`],
                  ["Requestor", event.requestor],
                  ["Plant / company", `${event.plant} · ${event.company}`],
                  ["Purchasing", `${event.purch_org} · ${event.purch_group}`],
                  ["Cost centre", event.cost_centre],
                  ["Approved on", dateShort(event.approval_date)],
                  ["Due", dateShort(event.due)],
                ]}
              />
            </div>
          </div>
        )}
        {tab === "conversation" &&
          (session ? (
            <div className="max-h-[32rem] overflow-auto pr-1">
              <ChatLog turns={session.turns} vendorName={session.vendor_name} />
            </div>
          ) : (
            <p className="text-sm text-muted">There was no conversation for this item.</p>
          ))}
        {tab === "comparison" &&
          (detail.comparison.rows.length ? (
            <ComparisonMatrix view={detail.comparison} direction={d} unit={item.unit} />
          ) : (
            <p className="text-sm text-muted">No quotes to compare.</p>
          ))}
        {tab === "history" && <HistoryTab detail={detail} />}
      </div>
    </Panel>
  );
}
