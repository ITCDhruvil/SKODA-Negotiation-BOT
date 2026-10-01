"use client";

import { Pill } from "@/components/ui/basics";
import type { Column } from "@/components/ui/DataTable";
import { IconLink } from "@/components/ui/TableToolbar";
import type { HistoryPoint } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import type { Tone } from "@/lib/labels";

export const DECISION_LABEL = { gain: "Gain", even: "Even", loss: "Loss" } as const;
export const DECISION_TONE: Record<keyof typeof DECISION_LABEL, Tone> = { gain: "ok", even: "muted", loss: "red" };

/** The money result of a past deal, coloured: green for a gain, red for a loss. */
export function ResultCell({ p }: { p: HistoryPoint }) {
  if (p.result == null || p.decision == null) return <span className="text-muted">—</span>;
  const tone = p.decision === "gain" ? "text-ok" : p.decision === "loss" ? "text-red" : "text-muted";
  const sign = p.result > 0 ? "+" : p.result < 0 ? "−" : "";
  return (
    <span className={`whitespace-nowrap font-semibold tabular-nums ${tone}`}>
      {sign}
      {money(Math.abs(p.result))}
      <span className="ml-1 text-xs font-medium opacity-80">
        ({p.result_pct != null && p.result_pct > 0 ? "+" : ""}
        {p.result_pct}%)
      </span>
    </span>
  );
}

export function DecisionPill({ p }: { p: HistoryPoint }) {
  if (!p.decision) return <span className="text-muted">—</span>;
  return <Pill tone={DECISION_TONE[p.decision]}>{DECISION_LABEL[p.decision]}</Pill>;
}

/** Columns for a table of past deals; `showVendor` adds the vendor (for lists that are not about one vendor). */
export function pastDealColumns(opts: { showVendor?: boolean } = {}): Column<HistoryPoint>[] {
  const cols: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", sort: (h) => h.date, cell: (h) => <span className="whitespace-nowrap">{dateShort(h.date)}</span> },
    { key: "item", header: "Item", sort: (h) => h.description.toLowerCase(), cell: (h) => <span className="font-semibold text-ink">{h.description}</span> },
  ];
  if (opts.showVendor) cols.push({ key: "vendor", header: "Vendor", hideOnMobile: true, sort: (h) => h.vendor_name.toLowerCase(), cell: (h) => h.vendor_name });
  cols.push(
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, sort: (h) => h.qty, cell: (h) => `${num(h.qty)} ${h.unit}` },
    { key: "price", header: "Price", align: "right", sort: (h) => h.unit_price, cell: (h) => <span className="whitespace-nowrap font-semibold tabular-nums">{money(h.unit_price)}</span> },
    { key: "value", header: "Value", align: "right", hideOnMobile: true, sort: (h) => h.value, cell: (h) => <span className="whitespace-nowrap tabular-nums">{money(h.value)}</span> },
    { key: "result", header: "Profit / loss", align: "right", sort: (h) => h.result, cell: (h) => <ResultCell p={h} /> },
    { key: "decision", header: "Decision", align: "center", className: "w-[1%]", sort: (h) => h.decision, cell: (h) => <DecisionPill p={h} /> },
    { key: "neg", header: "", className: "w-[1%]", hideOnMobile: true, cell: (h) => (h.negotiated ? <Pill tone="info">Negotiated</Pill> : null) },
    { key: "open", header: "", align: "right", className: "w-[1%]", cell: (h) => <IconLink href={`/history/${h.id}`} icon="eye" label="Review this deal" /> },
  );
  return cols;
}
