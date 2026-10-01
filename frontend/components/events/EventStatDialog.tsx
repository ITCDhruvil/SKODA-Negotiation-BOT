"use client";

import Link from "next/link";
import { Delta, Pill } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading } from "@/components/ui/State";
import { api, type EventView, type ItemView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { STATE_LABEL, STATE_TONE, quoteLabel } from "@/lib/labels";

export type StatKind = "items" | "vendors" | "value" | "potential";

const TITLE: Record<StatKind, string> = {
  items: "Items in this event",
  vendors: "Vendors on this event",
  value: "Where the value comes from",
  potential: "Where the potential comes from",
};

type VendorRow = { id: string; name: string; rating: number; language: string; items: string[]; responded: number };

async function loadVendors(items: ItemView[]): Promise<VendorRow[]> {
  const details = await Promise.all(items.map((i) => api.item(i.id)));
  const byId = new Map<string, VendorRow>();
  details.forEach((d, idx) => {
    for (const v of d.invitees) {
      const row = byId.get(v.vendor_id) ?? { id: v.vendor_id, name: v.vendor_name, rating: v.rating, language: v.language, items: [], responded: 0 };
      row.items.push(items[idx].description);
      if (v.responded) row.responded += 1;
      byId.set(v.vendor_id, row);
    }
  });
  return [...byId.values()].sort((a, b) => b.responded - a.responded || a.name.localeCompare(b.name));
}

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

/** Pop-up with the detail behind a number in the events table. */
export function EventStatDialog({ event, kind, onClose }: { event: EventView | null; kind: StatKind; onClose: () => void }) {
  const open = event != null;
  const id = event?.id ?? "";
  const { data, error, errorStatus, loading, reload } = useApi(async () => {
    if (!event) return null;
    const detail = await api.event(event.id);
    const vendors = kind === "vendors" ? await loadVendors(detail.items) : [];
    return { items: detail.items, vendors };
  }, [id, kind]);

  return (
    <Dialog open={open} title={event ? `${TITLE[kind]} · ${event.id}` : ""} size="lg" onClose={onClose}>
      {loading && !data && <Loading label="Loading details" />}
      {error && !data && <ErrorBox message={error} status={errorStatus} onRetry={reload} />}
      {event && data && kind === "vendors" && (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line2 text-left text-xs font-semibold text-muted">
                <th className="py-2 pr-3">Vendor</th>
                <th className="px-3 py-2 text-center">Rating</th>
                <th className="px-3 py-2">Language</th>
                <th className="px-3 py-2 text-center">Responded</th>
                <th className="py-2 pl-3">Items</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.id} className="border-b border-line2 last:border-0 align-top">
                  <td className="py-2.5 pr-3">
                    <Link href={`/vendors/${v.id}`} className="font-semibold text-brand hover:underline">{v.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{v.rating.toFixed(1)}</td>
                  <td className="px-3 py-2.5">{LANG[v.language] ?? v.language}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{v.responded} / {v.items.length}</td>
                  <td className="py-2.5 pl-3 text-muted">{v.items.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {event && data && kind !== "vendors" && (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line2 text-left text-xs font-semibold text-muted">
                <th className="py-2 pr-3">Item</th>
                <th className="px-3 py-2 text-right">Quantity</th>
                <th className="px-3 py-2 text-right">Best {quoteLabel(event.direction).toLowerCase()}</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-right">Potential</th>
                <th className="py-2 pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-line2 last:border-0">
                  <td className="py-2.5 pr-3">
                    <Link href={`/items/${i.id}`} className="font-semibold text-brand hover:underline">{i.description}</Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(i.qty)} {i.unit}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(i.best_bid)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${kind === "value" ? "font-bold text-ink" : ""}`}>{money(i.value)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right"><Delta value={i.potential_delta} direction={event.direction} /></td>
                  <td className="py-2.5 pl-3"><Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
