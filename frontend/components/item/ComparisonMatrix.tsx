import Link from "next/link";
import type { ComparisonView, Direction } from "@/lib/api";
import { money } from "@/lib/format";
import { bestLabel, deltaLabel, limitLabel } from "@/lib/labels";
import { Pill } from "@/components/ui/basics";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

export function ComparisonMatrix({ view, direction }: { view: ComparisonView; direction: Direction }) {
  const { rows, summary } = view;
  const cell = "px-4 py-2.5 align-top whitespace-nowrap tabular-nums";
  const label = "sticky left-0 z-10 bg-panel px-4 py-2.5 text-left text-xs font-semibold text-muted whitespace-nowrap";
  const tint = (best: boolean, bestEff: boolean) =>
    best ? "bg-ok-soft" : bestEff ? "bg-brand-soft" : "";
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Best quote", money(summary.best_price)],
          ["Best overall", money(summary.best_effective_price)],
          ["Target", money(summary.target)],
          [limitLabel(direction), money(summary.limit)],
          ["Bid spread", summary.spread == null ? "—" : `${(summary.spread * 100).toFixed(1)}%`],
          [`Potential ${deltaLabel(direction).toLowerCase()}`, money(summary.potential_delta)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-m border border-line2 bg-raise px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-bold text-ink tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-m border border-line2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line2 bg-raise">
              <th className={label}>Vendor</th>
              {rows.map((r) => (
                <th key={r.bid_id} className="px-4 py-2.5 text-left align-top">
                  <Link href={`/vendors/${r.vendor_id}`} className="font-semibold text-ink hover:underline">
                    {r.vendor_name}
                  </Link>
                  <div className="text-xs font-normal text-muted">Rating {r.vendor_rating.toFixed(1)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line2 [&>tr:last-child]:border-0">
            <tr>
              <th className={label}>Unit price</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={`${cell} ${tint(r.is_best_price, false)} font-bold text-ink`}>
                  {money(r.unit_price)}
                  {r.is_best_price && (
                    <div className="mt-1">
                      <Pill tone="ok">{bestLabel(direction)} quote</Pill>
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Effective price</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={`${cell} ${tint(false, r.is_best_effective)}`}>
                  {money(r.effective_price)}
                  {r.is_best_effective && (
                    <div className="mt-1">
                      <Pill tone="brand">Best overall</Pill>
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Gap to target</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>
                  {r.gap_to_target > 0 ? money(r.gap_to_target) : <span className="text-ok">On target</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Payment terms</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.payment_code}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Incoterm</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.incoterm}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>{direction === "buy" ? "Lead time" : "Pickup time"}</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.delivery_days} days</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Warranty</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.warranty_months ? `${r.warranty_months} months` : "—"}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Validity</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.validity_days} days</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Penalty clause</th>
              {rows.map((r) => (
                <td key={r.bid_id} className="px-4 py-2.5 align-top text-xs text-text">{r.penalty_clause || "—"}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Reply language</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{LANG[r.language] ?? r.language}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Effective price adjusts each quote for payment days, freight terms, delivery time and warranty (illustrative rates), so offers with different terms can be compared fairly.
      </p>
    </div>
  );
}
