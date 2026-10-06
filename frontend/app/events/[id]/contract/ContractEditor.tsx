"use client";

import { useRef, type ReactNode } from "react";
import { Button, Field, inputClass } from "@/components/ui/basics";
import { DEFAULT_LOGO, recalc, type EditableContract } from "./contract-edit";

type Item = EditableContract["items"][number];
type Approval = EditableContract["approvals"][number];
type Clause = EditableContract["clauses"][number];

const MAX_LOGO_BYTES = 1_000_000;

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-m border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-bold text-ink">
        {title}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="grid gap-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  );
}

function Text({ label, value, onChange, type = "text", area = false }: {
  label: string; value: string | number | null | undefined; onChange: (v: string) => void; type?: string; area?: boolean;
}) {
  return (
    <Field label={label}>
      {area ? (
        <textarea className={`${inputClass} min-h-[84px] resize-y`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputClass} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

const num = (v: string): number => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

/** The side panel: every part of the contract as a field, filled from the contract. Each keystroke goes straight to the sheet. */
export function ContractEditor({ docs, index, onIndex, onChange, onSave, onCancel, onReset, canReset }: {
  docs: EditableContract[];
  index: number;
  onIndex: (i: number) => void;
  onChange: (d: EditableContract) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const d = docs[index];
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<EditableContract>) => onChange(recalc({ ...d, ...patch }));
  const setItem = (n: number, patch: Partial<Item>) => set({ items: d.items.map((x, k) => (k === n ? { ...x, ...patch } : x)) });
  const setApproval = (n: number, patch: Partial<Approval>) => set({ approvals: d.approvals.map((x, k) => (k === n ? { ...x, ...patch } : x)) });
  const setClause = (n: number, patch: Partial<Clause>) => set({ clauses: d.clauses.map((x, k) => (k === n ? { ...x, ...patch } : x)) });
  const date = (v: string): string | null => v || null;

  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_LOGO_BYTES) {
      window.alert("The logo is larger than 1 MB. Use a smaller image.");
      return;
    }
    const r = new FileReader();
    r.onload = () => set({ logo_url: String(r.result) });
    r.readAsDataURL(f);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-base font-extrabold text-ink">Edit contract</h2>
        <p className="text-xs text-muted">Changes show on the contract as you type. Save keeps them in this browser.</p>
        {docs.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {docs.map((x, n) => (
              <button
                key={n}
                type="button"
                onClick={() => onIndex(n)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${n === index ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:text-ink"}`}
              >
                {x.contract_no}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-3">
        <Section title="Letterhead and logo" open>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.logo_url} alt="Logo" className="h-14 w-14 rounded-m border border-line bg-white object-contain p-1" />
            <div className="flex flex-wrap gap-2">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
              <Button size="sm" onClick={() => file.current?.click()}>Upload logo</Button>
              {d.logo_url !== DEFAULT_LOGO && <Button size="sm" variant="ghost" onClick={() => set({ logo_url: DEFAULT_LOGO })}>Use original</Button>}
            </div>
          </div>
          <Text label="Company name" value={d.company_name} onChange={(v) => set({ company_name: v })} />
          <Text label="Address" value={d.company_address} onChange={(v) => set({ company_address: v })} area />
          <div className="grid grid-cols-2 gap-3">
            <Text label="GSTIN" value={d.company_gstin} onChange={(v) => set({ company_gstin: v })} />
            <Text label="CIN" value={d.company_cin} onChange={(v) => set({ company_cin: v })} />
          </div>
        </Section>

        <Section title="Contract details" open>
          <Text label="Contract type" value={d.contract_type} onChange={(v) => set({ contract_type: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Text label="Contract no." value={d.contract_no} onChange={(v) => set({ contract_no: v })} />
            <Text label="Version" value={d.version} onChange={(v) => set({ version: v })} />
            <Text label="Dated" type="date" value={d.date} onChange={(v) => set({ date: v || d.date })} />
            <Text label="Locked on" type="date" value={d.locked_at} onChange={(v) => set({ locked_at: v || d.locked_at })} />
            <Text label="Valid until" type="date" value={d.valid_until} onChange={(v) => set({ valid_until: date(v) })} />
            <Text label="Delivery by" type="date" value={d.delivery_by} onChange={(v) => set({ delivery_by: v || d.delivery_by })} />
          </div>
        </Section>

        <Section title="Parties">
          <Text label="Buyer" value={d.buyer_name} onChange={(v) => set({ buyer_name: v })} />
          <Text label="Buyer detail" value={d.buyer_detail} onChange={(v) => set({ buyer_detail: v })} />
          <Text label="Seller" value={d.seller_name} onChange={(v) => set({ seller_name: v })} />
          <Text label="Seller detail" value={d.seller_detail} onChange={(v) => set({ seller_detail: v })} />
        </Section>

        <Section title="Reference">
          <div className="grid grid-cols-2 gap-3">
            <Text label="Request no." value={d.request_no} onChange={(v) => set({ request_no: v })} />
            <Text label="Shopping cart" value={d.cart_no} onChange={(v) => set({ cart_no: v || null })} />
            <Text label="Requestor" value={d.requestor} onChange={(v) => set({ requestor: v })} />
            <Text label="Cost centre" value={d.cost_centre} onChange={(v) => set({ cost_centre: v })} />
          </div>
        </Section>

        <Section title="Schedule and value">
          {d.items.map((it, n) => (
            <div key={n} className="grid gap-2 rounded-m border border-line p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted">Line {n + 1}</span>
                {d.items.length > 1 && (
                  <button type="button" className="text-xs font-semibold text-red-500 hover:underline" onClick={() => set({ items: d.items.filter((_, k) => k !== n).map((x, k) => ({ ...x, position: k + 1 })) })}>Remove</button>
                )}
              </div>
              <Text label="Description" value={it.description} onChange={(v) => setItem(n, { description: v })} />
              <div className="grid grid-cols-3 gap-2">
                <Text label="Quantity" type="number" value={it.qty} onChange={(v) => setItem(n, { qty: num(v) })} />
                <Text label="Unit" value={it.unit} onChange={(v) => setItem(n, { unit: v as Item["unit"] })} />
                <Text label="Price per unit" type="number" value={it.unit_price} onChange={(v) => setItem(n, { unit_price: num(v) })} />
              </div>
            </div>
          ))}
          <Button size="sm" onClick={() => set({ items: [...d.items, { position: d.items.length + 1, description: "", qty: 1, unit: d.items[0]?.unit ?? ("EA" as Item["unit"]), unit_price: 0, value: 0, original_price: 0 }] })}>Add a line</Button>
          <Text label="Original quoted value" type="number" value={d.original_value} onChange={(v) => set({ original_value: num(v) })} />
          <p className="text-xs text-muted">The contract value and the gain from the negotiation follow from the lines and the original value.</p>
        </Section>

        <Section title="Commercial terms and tenure">
          <div className="grid grid-cols-2 gap-3">
            <Text label="Payment terms" value={d.payment_terms} onChange={(v) => set({ payment_terms: v })} />
            <Text label="Incoterm" value={d.incoterm} onChange={(v) => set({ incoterm: v })} />
            <Text label="Contract term (months)" type="number" value={d.tenure_months} onChange={(v) => set({ tenure_months: v ? Math.round(num(v)) : null })} />
            <Text label="Term starts" type="date" value={d.term_starts} onChange={(v) => set({ term_starts: date(v) })} />
            <Text label="Term ends" type="date" value={d.term_ends} onChange={(v) => set({ term_ends: date(v) })} />
            <Text label="Renewal reminder" type="date" value={d.renewal_reminder} onChange={(v) => set({ renewal_reminder: date(v) })} />
          </div>
          <p className="text-xs text-muted">The end date at the top is the term end when set, else the valid until date.</p>
        </Section>

        <Section title="Terms and conditions">
          {d.clauses.map((c, n) => (
            <div key={n} className="grid gap-2 rounded-m border border-line p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted">Clause {n + 1}</span>
                <button type="button" className="text-xs font-semibold text-red-500 hover:underline" onClick={() => set({ clauses: d.clauses.filter((_, k) => k !== n) })}>Remove</button>
              </div>
              <Text label="Heading" value={c.heading} onChange={(v) => setClause(n, { heading: v })} />
              <Text label="Text" value={c.text} onChange={(v) => setClause(n, { text: v })} area />
            </div>
          ))}
          <Button size="sm" onClick={() => set({ clauses: [...d.clauses, { heading: "New clause", text: "" }] })}>Add a clause</Button>
        </Section>

        <Section title="Approvals">
          {d.approvals.map((a, n) => (
            <div key={n} className="grid gap-2 rounded-m border border-line p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted">Approver {n + 1}</span>
                <button type="button" className="text-xs font-semibold text-red-500 hover:underline" onClick={() => set({ approvals: d.approvals.filter((_, k) => k !== n) })}>Remove</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Text label="Role" value={a.role} onChange={(v) => setApproval(n, { role: v })} />
                <Text label="Name" value={a.name} onChange={(v) => setApproval(n, { name: v })} />
                <Text label="Status" value={a.status} onChange={(v) => setApproval(n, { status: v })} />
                <Text label="E-sign id" value={a.esign_id} onChange={(v) => setApproval(n, { esign_id: v })} />
              </div>
              <Text label="Signed at" type="datetime-local" value={a.signed_at.slice(0, 16)} onChange={(v) => v && setApproval(n, { signed_at: v })} />
            </div>
          ))}
          <Button size="sm" onClick={() => set({ approvals: [...d.approvals, { role: "Approver", name: "", status: "Approved", date: d.locked_at, esign_id: "", signed_at: `${d.locked_at}T10:00` }] })}>Add an approver</Button>
        </Section>

        <Section title="Distribution">
          {d.distribution.map((t, n) => (
            <div key={n} className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><Text label={`Line ${n + 1}`} value={t} onChange={(v) => set({ distribution: d.distribution.map((x, k) => (k === n ? v : x)) })} /></div>
              <button type="button" className="mt-6 text-xs font-semibold text-red-500 hover:underline" onClick={() => set({ distribution: d.distribution.filter((_, k) => k !== n) })}>Remove</button>
            </div>
          ))}
          <Button size="sm" onClick={() => set({ distribution: [...d.distribution, ""] })}>Add a line</Button>
        </Section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="primary" onClick={onSave}>Save</Button>
        <Button onClick={onCancel}>Cancel</Button>
        {canReset && <Button variant="ghost" className="ml-auto" onClick={onReset}>Reset to original</Button>}
      </div>
    </div>
  );
}
