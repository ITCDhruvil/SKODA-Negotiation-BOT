"use client";

import Link from "next/link";
import { ToughnessBadge } from "@/components/negotiation/ToughnessBadge";
import type { ReactNode } from "react";
import { Avatar } from "@/components/negotiation/ChatLog";
import { Pill } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading } from "@/components/ui/State";
import { api, type SessionView } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { LANGUAGE_LABEL, MODE_LABEL, TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";
import { USER } from "@/lib/user";

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="break-words font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Head({ name, line, extra }: { name: string; line: string; extra?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <Avatar name={name} size={56} />
      <div className="min-w-0">
        <h3 className="truncate text-lg font-bold text-ink">{name}</h3>
        <p className="text-sm text-muted">{line}</p>
        {extra && <div className="mt-1.5 flex flex-wrap gap-2">{extra}</div>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-line2 pt-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      {children}
    </section>
  );
}

function VendorProfile({ s }: { s: SessionView }) {
  const { data, error, errorStatus, loading, reload } = useApi(() => api.vendor(s.vendor_id), [s.vendor_id]);
  if (loading && !data) return <Loading label="Loading vendor" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  const v = data.vendor;
  return (
    <>
      <Head
        name={v.name}
        line={`${v.type === "supplier" ? "Supplier" : "Scrap buyer"} · SAP ${v.sap_no}`}
        extra={
          <>
            <Pill tone="muted">{v.rating.toFixed(1)} / 5 rating</Pill>
            <ToughnessBadge vendorName={v.name} toughness={v.toughness} />
          </>
        }
      />
      <Rows
        rows={[
          ["Preferred payment", v.payment_pref],
          ["Language in this chat", LANGUAGE_LABEL[s.language]],
          ["Past deals", num(v.past_deals)],
          ["Closed with us", num(v.closed_deals)],
          ["Live bids now", num(v.live_bid_count)],
          ["Value quoted now", money(v.quoted_value)],
        ]}
      />
      <Section title="In this negotiation">
        <Rows
          rows={[
            ["First quote", `${money(s.original_price)} per ${s.unit}`],
            ["Latest offer", `${money(s.vendor_offer)} per ${s.unit} · ${s.vendor_payment}`],
            ["Our last offer", s.our_offer == null ? "—" : `${money(s.our_offer)} per ${s.unit}`],
            ["Rounds", String(s.round)],
          ]}
        />
      </Section>
      <Section title="From past deals">
        <p className="text-sm text-text">{v.toughness.note}</p>
      </Section>
      <div className="mt-5 flex justify-end">
        <Link href={`/vendors/${v.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
          Open vendor page
        </Link>
      </div>
    </>
  );
}

function BuyerProfile({ s }: { s: SessionView }) {
  const { data, error, errorStatus, loading, reload } = useApi(() => api.event(s.event_id), [s.event_id]);
  if (loading && !data) return <Loading label="Loading profile" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  const e = data.event;
  const sent = s.turns.filter((t) => t.speaker === "us");
  return (
    <>
      <Head name={USER.name} line={`${USER.role} · ${USER.site}`} extra={<Pill tone="ok">Online</Pill>} />
      <Rows
        rows={[
          ["Company", e.company],
          ["Plant", e.plant],
          ["Purchasing organisation", e.purch_org],
          ["Purchasing group", e.purch_group],
          ["Event requestor", e.requestor],
          ["Cost centre", e.cost_centre],
        ]}
      />
      <Section title="In this negotiation">
        <Rows
          rows={[
            ["Mode", MODE_LABEL[s.mode]],
            ["Messages sent", String(sent.length)],
            ["Started", dateShort(s.started_at)],
            ["Event", `${e.id} · ${e.title}`],
          ]}
        />
      </Section>
    </>
  );
}

/** The details of one side of the conversation, opened by clicking its avatar. */
export function ProfileDialog({ who, session, onClose }: { who: "us" | "vendor" | null; session: SessionView; onClose: () => void }) {
  return (
    <Dialog open={who !== null} title={who === "us" ? "Your profile" : "Vendor profile"} onClose={onClose} size="lg">
      {who === "vendor" && <VendorProfile s={session} />}
      {who === "us" && <BuyerProfile s={session} />}
    </Dialog>
  );
}
