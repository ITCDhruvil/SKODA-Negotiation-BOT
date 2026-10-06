"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/basics";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api } from "@/lib/api";
import { dateShort, dateTimeShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel, tenureLabel } from "@/lib/labels";
import { ContractEditor } from "./ContractEditor";
import { clearEdit, loadEdit, saveEdit, withDefaults, type EditableContract } from "./contract-edit";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-words text-sm font-medium text-neutral-900">{children}</dd>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 border-b border-neutral-300 pb-1 text-xs font-bold uppercase tracking-wider text-neutral-700">{children}</h3>;
}

/** One contract on a printable sheet. Always light, whatever the app's theme, because it is a document. */
function Sheet({ d, eventId, edited, editing }: { d: EditableContract; eventId: string; edited: boolean; editing: boolean }) {
  const verifyUrl = `${typeof window === "undefined" ? "" : window.location.origin}/events/${eventId}/contract?verify=${d.doc_hash.slice(0, 16)}`;
  const gain = deltaLabel(d.direction);
  // End date at the top: the end of the tenure when there is one, else the validity, else the delivery date.
  const end = d.term_ends
    ? { label: "Ends on", date: d.term_ends }
    : d.valid_until
      ? { label: "Valid until", date: d.valid_until }
      : { label: "Delivery by", date: d.delivery_by };
  return (
    <article className={`contract-sheet mb-8 mx-auto max-w-[860px] ${editing ? "xl:max-w-none" : ""} rounded-card border border-line bg-white px-10 py-9 text-neutral-900 shadow-card`}>
      <header className="border-b-2 border-neutral-900 pb-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.logo_url} alt="Logo" className="h-16 w-16 shrink-0 object-contain" />
              <p className="text-base font-extrabold uppercase leading-tight tracking-wide text-[#0e3a2f]">{d.company_name}</p>
            </div>
            <p className="mt-3 text-xs leading-snug text-neutral-600">{d.company_address}</p>
            <p className="text-xs text-neutral-600">GSTIN {d.company_gstin} <span className="mx-1 text-neutral-400">|</span> CIN {d.company_cin}</p>
          </div>
          <dl className="min-w-[230px] rounded-md border border-neutral-300 bg-neutral-50 px-3.5 py-2.5 text-sm">
            {[
              ["Contract no.", d.contract_no],
              ["Version", d.version],
              ["Dated", dateShort(d.date)],
              [end.label, dateShort(end.date)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-6 py-0.5">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="font-semibold tabular-nums text-neutral-900">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold tracking-tight">{d.contract_type}</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Approved and locked on {dateShort(d.locked_at)}
          </span>
        </div>
      </header>

      <Heading>Parties</Heading>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs text-neutral-500">Buyer</p>
          <p className="font-bold">{d.buyer_name}</p>
          <p className="text-sm text-neutral-600">{d.buyer_detail}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Seller</p>
          <p className="font-bold">{d.seller_name}</p>
          <p className="text-sm text-neutral-600">{d.seller_detail}</p>
        </div>
      </div>

      <Heading>Reference</Heading>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
        <Field label="Request no.">{d.request_no}</Field>
        <Field label="Shopping cart">{d.cart_no ?? "—"}</Field>
        <Field label="Requestor">{d.requestor}</Field>
        <Field label="Cost centre">{d.cost_centre}</Field>
      </dl>

      <Heading>Schedule</Heading>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-600">
            <th className="py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">Description</th>
            <th className="py-1.5 pr-2 text-right">Quantity</th>
            <th className="py-1.5 pr-2 text-right">Price per unit</th>
            <th className="py-1.5 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.position} className="border-b border-neutral-200">
              <td className="py-2 pr-2 tabular-nums">{i.position}</td>
              <td className="py-2 pr-2">{i.description}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{num(i.qty)} {i.unit}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(i.unit_price)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{money(i.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-3 text-right text-sm text-neutral-600">Original quoted value</td>
            <td className="pt-3 text-right tabular-nums text-neutral-600">{money(d.original_value)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="pt-1 text-right text-sm font-bold">Contract value</td>
            <td className="pt-1 text-right text-base font-extrabold tabular-nums">{money(d.total_value)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="pt-1 text-right text-sm text-neutral-600">{gain} from the negotiation</td>
            <td className="pt-1 text-right font-semibold tabular-nums text-emerald-700">{money(d.saved)}</td>
          </tr>
        </tfoot>
      </table>

      <Heading>Commercial terms</Heading>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
        <Field label="Payment terms">{d.payment_terms}</Field>
        <Field label="Incoterm">{d.incoterm}</Field>
        <Field label="Delivery by">{dateShort(d.delivery_by)}</Field>
        <Field label="Valid until">{d.valid_until ? dateShort(d.valid_until) : "—"}</Field>
        {d.tenure_months ? (
          <>
            <Field label="Contract term">{tenureLabel(d.tenure_months)}</Field>
            <Field label="Term starts">{d.term_starts ? dateShort(d.term_starts) : "—"}</Field>
            <Field label="Term ends">{d.term_ends ? dateShort(d.term_ends) : "—"}</Field>
            <Field label="Renewal reminder">{d.renewal_reminder ? dateShort(d.renewal_reminder) : "—"}</Field>
          </>
        ) : null}
      </dl>

      <Heading>Terms and conditions</Heading>
      <ol className="space-y-2 text-sm leading-snug text-neutral-800">
        {d.clauses.map((c, n) => (
          <li key={c.heading}>
            <span className="font-bold">{n + 1}. {c.heading}.</span> {c.text}
          </li>
        ))}
      </ol>

      <Heading>Approval</Heading>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-600">
            <th className="py-1.5 pr-2">Role</th>
            <th className="py-1.5 pr-2">Name</th>
            <th className="py-1.5 pr-2">Status</th>
            <th className="py-1.5">Electronic signature</th>
          </tr>
        </thead>
        <tbody>
          {d.approvals.map((a) => (
            <tr key={a.role} className="border-b border-neutral-200">
              <td className="py-3 pr-2 font-medium">{a.role}</td>
              <td className="py-3 pr-2">{a.name}</td>
              <td className="py-3 pr-2 text-emerald-700">{a.status}</td>
              <td className="py-3 text-xs tabular-nums">
                <span className="block font-semibold text-neutral-900">Signed electronically · {a.esign_id}</span>
                <span className="text-neutral-500">{dateTimeShort(a.signed_at)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Heading>Distribution</Heading>
      <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-800">
        {d.distribution.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <footer className="keep mt-8 flex items-center gap-4 border-t border-neutral-300 pt-4">
        <QRCodeSVG value={verifyUrl} size={84} level="M" />
        <div className="min-w-0 text-xs text-neutral-600">
          <p className="font-semibold text-neutral-800">Scan to verify this contract</p>
          <p>Document hash (SHA-256)</p>
          <p className="break-all font-mono text-[10px]">{d.doc_hash}</p>
          <p className="mt-1">{d.contract_no} · version {d.version} · locked {dateShort(d.locked_at)}. {edited ? "This copy was edited after locking; the hash is of the originally locked contract." : "Any change to the deal gives a different hash."}</p>
        </div>
      </footer>
    </article>
  );
}

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, errorStatus, loading, reload } = useApi(() => api.contract(id), [id]);
  // "Download contract" links here with ?print=1: the print dialog opens once the document is on screen.
  useEffect(() => {
    if (!data || new URLSearchParams(window.location.search).get("print") !== "1") return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [data]);
  // A scanned QR code lands here with ?verify=<start of the hash>: compare it with the hash of the stored contract.
  const [scanned, setScanned] = useState<string | null>(null);
  useEffect(() => setScanned(new URLSearchParams(window.location.search).get("verify")), []);

  // The contracts as shown: the stored ones, with any edits saved in this browser. While editing, the draft is shown.
  const [shown, setShown] = useState<EditableContract[]>([]);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<EditableContract[] | null>(null);
  const [which, setWhich] = useState(0);
  useEffect(() => {
    if (!data) return;
    const saved = data.map((d) => loadEdit(d));
    setShown(data.map((d, n) => saved[n] ?? withDefaults(d)));
    setEdited(new Set(data.filter((_, n) => saved[n]).map((d) => d.contract_no)));
    setDraft(null);
  }, [data]);

  if (loading && !data) return <Loading label="Preparing the contract" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;

  const editing = draft !== null;
  const docs = draft ?? shown;
  const startEdit = () => { setDraft(shown.map((d) => ({ ...d }))); setWhich(0); };
  const save = () => {
    if (!draft) return;
    const ok = draft.map((d, n) => saveEdit(data[n], d));
    setShown(draft);
    setEdited(new Set(data.map((d) => d.contract_no)));
    setDraft(null);
    if (ok.includes(false)) window.alert("The changes show here but could not be kept in this browser (storage is full or blocked).");
  };
  const reset = () => {
    data.forEach((d) => clearEdit(d.contract_no));
    setShown(data.map(withDefaults));
    setEdited(new Set());
    setDraft(null);
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          crumbs={
            <>
              <Link href="/events" className="hover:underline">Events</Link> /{" "}
              <Link href={`/events/${id}`} className="hover:underline">{id}</Link> / Contract
            </>
          }
          title="Contract document"
          subtitle={`${data.length} ${data.length === 1 ? "contract" : "contracts"} for this deal · built from the negotiation result`}
          actions={
            <>
              {!editing && <Button onClick={startEdit}>Edit</Button>}
              <Button variant="primary" onClick={() => window.print()}>Print or save as PDF</Button>
            </>
          }
        />
      </div>
      {scanned ? (
        data.some((d) => d.doc_hash.startsWith(scanned)) ? (
          <p className="no-print mx-auto mb-4 max-w-[860px] rounded-card border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Verified: the scanned code matches this contract as it is stored.</p>
        ) : (
          <p className="no-print mx-auto mb-4 max-w-[860px] rounded-card border border-red-600 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">Not verified: the scanned code does not match this contract. The copy you hold may be old or changed.</p>
        )
      ) : null}
      {edited.size > 0 && !editing ? (
        <p className="no-print mx-auto mb-4 flex max-w-[860px] flex-wrap items-center justify-between gap-2 rounded-card border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 xl:mx-0">
          This is an edited copy, kept in this browser. The locked contract on the server is unchanged.
          <button type="button" className="underline" onClick={reset}>Reset to original</button>
        </p>
      ) : null}
      <div className={editing ? "xl:grid xl:grid-cols-[minmax(0,1fr)_460px] xl:items-start xl:gap-6" : ""}>
        <div className="min-w-0">
          {docs.map((d, n) => (
            <Sheet key={n} d={d} eventId={id} edited={edited.has(d.contract_no)} editing={editing} />
          ))}
        </div>
        {draft ? (
          <aside className="no-print fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] border-l border-line bg-bg shadow-card xl:sticky xl:top-4 xl:z-auto xl:h-[calc(100vh-2rem)] xl:w-auto xl:rounded-card xl:border">
            <ContractEditor
              docs={draft}
              index={Math.min(which, draft.length - 1)}
              onIndex={setWhich}
              onChange={(d) => setDraft(draft.map((x, n) => (n === which ? d : x)))}
              onSave={save}
              onCancel={() => setDraft(null)}
              onReset={reset}
              canReset={edited.size > 0}
            />
          </aside>
        ) : null}
      </div>
    </>
  );
}
