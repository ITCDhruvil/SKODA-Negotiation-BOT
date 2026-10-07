"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/basics";
import { api, type ItemDetail, type SessionSummary } from "@/lib/api";
import { STEPS, quoteLabel } from "@/lib/labels";

/** A one-line "what to do now" bar, driven by the item's state. */
export function NextStep({
  detail,
  sessions,
  onOpenVendors,
  onOpenOpportunity,
  onChanged,
}: {
  detail: ItemDetail;
  sessions: SessionSummary[];
  onOpenVendors: () => void;
  onOpenOpportunity: () => void;
  onChanged: () => Promise<void>;
}) {
  const { item, event } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = quoteLabel(event.direction).toLowerCase();
  const last = sessions[sessions.length - 1];

  const stepIndex = Math.max(0, STEPS.findIndex((x) => x.states.includes(item.state)));
  const stepName = STEPS[stepIndex]?.label ?? "";
  let headline = "";
  let text: ReactNode = null;
  let then = "";
  let action: ReactNode = null;
  switch (item.state) {
    case "draft":
      headline = "Set your target and walk-away limit";
      text = "Fill in the points panel on the right, then confirm them.";
      then = "the vendors on this item are asked for their quotes.";
      break;
    case "points_reviewed":
    case "awaiting_bids":
      headline = `Get the vendor ${quote}s`;
      text = `The vendors below were invited when the event was created. In this demo their replies are simulated: use "Get quote" for each vendor, or "Get all quotes".`;
      then = `compare the ${quote}s and analyse them.`;
      action = <Button variant="primary" onClick={onOpenVendors}>Go to vendors</Button>;
      break;
    case "bids_in":
      headline = `Analyse the ${quote}s`;
      text = "This marks the comparison as reviewed and shows the negotiation opportunity.";
      then = "choose a vendor and start the negotiation.";
      action = (
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.analyze(item.id);
              await onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Analysing…" : `Analyse ${quote}s`}
        </Button>
      );
      break;
    case "analyzed":
      if (item.policy.band === "management") {
        headline = "Hand this over to higher management";
        text = item.policy.message;
        then = "management decides how to proceed; the quotes and comparison stay available here.";
        break;
      }
      headline = item.policy.band === "supervised" ? "Start the negotiation with a person in the loop" : "Start the negotiation";
      text = "Choose the vendor and who sends the messages in the highlighted card on the right, then start.";
      then = "review the agreed deal and send it for approval.";
      action = <Button variant="primary" onClick={onOpenOpportunity}>Choose vendor and start</Button>;
      break;
    case "negotiating":
      if (last && last.status === "on_hold") {
        headline = "A conversation is on hold";
        text = `${last.vendor_name} is waiting. Start with another vendor below, or resume this one.`;
        then = "when a vendor agrees you review the deal.";
        action = <Link href={`/negotiate/${last.id}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">Open conversation</Link>;
        break;
      }
      headline = "A conversation is in progress";
      text = last ? `Negotiating with ${last.vendor_name}.` : "A negotiation is in progress.";
      then = "when the vendor agrees you review the deal.";
      action = last ? <Link href={`/negotiate/${last.id}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">Open conversation</Link> : null;
      break;
    case "result_pending":
      headline = "Review the agreed deal";
      text = last ? `${last.vendor_name} agreed. Accept the deal or keep negotiating.` : "A deal was reached.";
      then = "the deal goes for approval.";
      action = last ? <Link href={`/negotiate/${last.id}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">Review the deal</Link> : null;
      break;
    case "awaiting_approval":
      headline = "Approve the deal";
      text = "The deal is ready for your final approval.";
      then = "the item is closed and recorded.";
      action = <Link href={`/events/${event.id}/approve`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-on-brand">Review &amp; approve</Link>;
      break;
    case "closed":
      headline = "This item is closed";
      text = "The result is recorded in the Outcome card and on the dashboard.";
      break;
    case "handed_back":
      headline = "No deal yet: try the next-best vendor";
      text = last ? `${last.vendor_name} did not agree. The next-best vendors are listed in the card on the right.` : "The last negotiation did not end in a deal.";
      then = "or close the item without a deal.";
      action = <Button variant="primary" onClick={onOpenOpportunity}>Show next-best vendors</Button>;
      break;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-m bg-brand-soft px-4 py-3.5" role="status">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">
          Next step · Step {stepIndex + 1} of {STEPS.length}: {stepName}
        </p>
        <p className="mt-0.5 text-base font-bold text-ink">{headline}</p>
        <p className="text-sm text-text">
          {text}
          {error && <span className="ml-2 text-red">{error}</span>}
        </p>
        {then && <p className="mt-1 text-xs text-muted">After this: {then}</p>}
      </div>
      {action}
    </div>
  );
}
