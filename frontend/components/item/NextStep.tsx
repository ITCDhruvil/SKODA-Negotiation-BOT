"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/basics";
import { api, type ItemDetail, type SessionSummary } from "@/lib/api";
import { quoteLabel } from "@/lib/labels";

/** A one-line "what to do now" bar, driven by the item's state. */
export function NextStep({
  detail,
  sessions,
  onOpenVendors,
  onChanged,
}: {
  detail: ItemDetail;
  sessions: SessionSummary[];
  onOpenVendors: () => void;
  onChanged: () => Promise<void>;
}) {
  const { item, event } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = quoteLabel(event.direction).toLowerCase();
  const last = sessions[sessions.length - 1];

  let text: ReactNode = null;
  let action: ReactNode = null;
  switch (item.state) {
    case "draft":
      text = "Set your target and walk-away limit, then confirm the points (panel on the right).";
      break;
    case "points_reviewed":
    case "awaiting_bids":
      text = `Waiting for vendors to send their ${quote}s. Open the vendor list and simulate each response.`;
      action = <Button variant="primary" onClick={onOpenVendors}>Go to vendors</Button>;
      break;
    case "bids_in":
      text = `The ${quote}s are in. Analyze them to see the comparison and the negotiation opportunity.`;
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
          Analyze {quote}s
        </Button>
      );
      break;
    case "analyzed":
      text = "Ready to negotiate. Choose the vendor and how much runs on its own in the card on the right, then start.";
      break;
    case "negotiating":
      text = last ? `A conversation with ${last.vendor_name} is in progress.` : "A negotiation is in progress.";
      action = last ? <Link href={`/negotiate/${last.id}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-white dark:text-[#07130f]">Open workspace</Link> : null;
      break;
    case "result_pending":
      text = last ? `${last.vendor_name} agreed. Accept the deal or keep negotiating.` : "A deal was reached.";
      action = last ? <Link href={`/negotiate/${last.id}`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-white dark:text-[#07130f]">Review result</Link> : null;
      break;
    case "awaiting_approval":
      text = "The deal is ready for approval.";
      action = <Link href={`/events/${event.id}/approve`} className="rounded-m border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-white dark:text-[#07130f]">Review &amp; approve</Link>;
      break;
    case "closed":
      text = "This item is closed. The result is recorded in the Outcome card and the dashboard.";
      break;
    case "handed_back":
      text = "The negotiation was handed back to you. Set new points and start again, or close the item without a deal.";
      break;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-m bg-brand-soft px-4 py-3" role="status">
      <p className="min-w-0 text-sm text-ink">
        <span className="font-bold">Next step: </span>
        {text}
        {error && <span className="ml-2 text-red">{error}</span>}
      </p>
      {action}
    </div>
  );
}
