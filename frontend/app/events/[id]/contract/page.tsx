"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/basics";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type ContractDoc } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel, tenureLabel } from "@/lib/labels";

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
function Sheet({ d }: { d: ContractDoc }) {
  const gain = deltaLabel(d.direction);
  return (
    <article className="contract-sheet mx-auto mb-8 max-w-[860px] rounded-card border border-line bg-white px-10 py-9 text-neutral-900 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-neutral-900 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">SKODA Auto Volkswagen India</p>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{d.contract_type}</h2>
          <p className="text-sm text-neutral-600">{d.title}</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-lg font-bold tabular-nums">{d.contract_no}</p>
          <p className="text-neutral-600">Dated {dateShort(d.date)}</p>
          <p className="mt-1 inline-block rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Sample document · demo data</p>
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
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-snug text-neutral-800">
        {d.terms.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>

      <Heading>Approval</Heading>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-600">
            <th className="py-1.5 pr-2">Role</th>
            <th className="py-1.5 pr-2">Name</th>
            <th className="py-1.5 pr-2">Status</th>
            <th className="py-1.5 pr-2">Date</th>
            <th className="py-1.5">Signature</th>
          </tr>
        </thead>
        <tbody>
          {d.approvals.map((a) => (
            <tr key={a.role} className="border-b border-neutral-200">
              <td className="py-3 pr-2 font-medium">{a.role}</td>
              <td className="py-3 pr-2">{a.name}</td>
              <td className="py-3 pr-2 text-emerald-700">{a.status}</td>
              <td className="py-3 pr-2 tabular-nums">{dateShort(a.date)}</td>
              <td className="w-40 py-3"><span className="block border-b border-neutral-400">&nbsp;</span></td>
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
      <p className="mt-6 text-xs text-neutral-500">Generated from the negotiation result. Demo data; not a binding document.</p>
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
  if (loading && !data) return <Loading label="Preparing the contract" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
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
          subtitle={`${data.length} ${data.length === 1 ? "contract" : "contracts"} for this deal · sample document built from the negotiation result`}
          actions={<Button variant="primary" onClick={() => window.print()}>Print or save as PDF</Button>}
        />
      </div>
      {data.map((d) => (
        <Sheet key={d.contract_no} d={d} />
      ))}
    </>
  );
}
