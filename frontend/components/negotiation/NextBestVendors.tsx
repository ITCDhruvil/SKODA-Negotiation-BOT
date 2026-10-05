"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Pill } from "@/components/ui/basics";
import { ErrorBox, Loading, Notice } from "@/components/ui/State";
import { api, type ItemDetail, type Mode } from "@/lib/api";
import { money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";

type Vendor = ItemDetail["next_vendors"][number];

/** When a negotiation did not end in a deal: who to try next, best first, with a one-click start. */
export function NextBestVendors({ itemId, vendors, mode = "approve", unit }: { itemId: string; vendors: Vendor[]; mode?: Mode; unit: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (vendors.length === 0) {
    return (
      <Notice tone="amber">
        No other vendor has quoted on this item. You can adjust your points and try again, or close the item without a deal.
      </Notice>
    );
  }
  const start = async (v: Vendor) => {
    setBusy(v.vendor_id);
    setError(null);
    try {
      const s = await api.startNegotiation(itemId, { vendor_id: v.vendor_id, mode });
      router.push(`/negotiate/${s.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  const shown = vendors.slice(0, 3);
  return (
    <div className="grid gap-2.5">
      {shown.map((v, i) => (
        <div key={v.vendor_id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-m border px-3.5 py-3 ${i === 0 ? "border-brand bg-brand-soft" : "border-line bg-panel"}`}>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
              {v.vendor_name}
              {i === 0 && <Pill tone="ok">Next best</Pill>}
              {v.toughness.level !== "unknown" && <Pill tone={TOUGH_TONE[v.toughness.level]}>{TOUGH_LABEL[v.toughness.level]}</Pill>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Quote <b className="tabular-nums text-ink">{money(v.unit_price)}</b> per {unit} · {v.payment_code} · after terms{" "}
              <b className="tabular-nums text-ink">{money(v.effective_price)}</b> · rating {v.rating.toFixed(1)}
              {v.within_limit ? " · inside your limit" : " · outside your limit"}
            </p>
          </div>
          <Button variant={i === 0 ? "primary" : "secondary"} size="sm" disabled={busy !== null} onClick={() => start(v)}>
            {busy === v.vendor_id ? "Starting…" : i === 0 ? "Negotiate with this vendor" : "Negotiate"}
          </Button>
        </div>
      ))}
      {vendors.length > shown.length && <p className="text-xs text-muted">{vendors.length - shown.length} more vendor(s) have quoted. Pick one from the vendor list on the item page.</p>}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

/** The same list, loaded for a conversation that has ended: it fetches the item to find who has not been tried yet. */
export function NextVendorsLoader({ itemId, mode, unit }: { itemId: string; mode: Mode; unit: string }) {
  const { data, error, errorStatus, loading, reload } = useApi(() => api.item(itemId), [itemId]);
  if (loading && !data) return <Loading label="Finding the next-best vendors" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  return <NextBestVendors itemId={itemId} vendors={data.next_vendors} mode={mode} unit={unit} />;
}
