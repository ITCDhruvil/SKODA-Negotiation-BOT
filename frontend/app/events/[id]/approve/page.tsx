"use client";

import Link from "next/link";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ItemReview, type ReviewEntry } from "@/components/approval/ItemReview";
import { Button, Delta, DirectionBadge, KpiCard, Panel, Pill } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type EventView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel } from "@/lib/labels";

async function load(eventId: string): Promise<{ event: EventView; entries: ReviewEntry[] }> {
  const ev = await api.event(eventId);
  const waiting = ev.items.filter((i) => i.state === "awaiting_approval");
  const entries = await Promise.all(
    waiting.map(async (item): Promise<ReviewEntry> => {
      const [detail, list] = await Promise.all([api.item(item.id), api.sessionsForItem(item.id)]);
      const agreed = [...list].reverse().find((x) => x.status === "agreed");
      const session = agreed ? await api.session(agreed.id) : null;
      const vendorId = session?.vendor_id ?? item.best_bid_vendor_id;
      const vendor = vendorId ? (await api.vendor(vendorId).catch(() => null))?.vendor ?? null : null;
      return { detail, session, vendor };
    }),
  );
  return { event: ev.event, entries };
}

export default function ApprovePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, errorStatus, loading, reload } = useApi(() => load(id), [id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (loading && !data) return <Loading label="Loading approvals" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;

  const { event, entries } = data;
  const d = event.direction;
  const current = entries.find((e) => e.detail.item.id === selected) ?? entries[0];
  const vendorCount = new Set(entries.map((e) => e.session?.vendor_id ?? e.detail.item.best_bid_vendor_id)).size;
  const negotiated = entries.filter((e) => e.session).length;

  const approve = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api.approveEvent(id);
      router.push(`/events/${id}`);
    } catch (e) {
      setConfirm(false);
      setFailure(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/events" className="hover:underline">Events</Link> /{" "}
            <Link href={`/events/${id}`} className="hover:underline">{id}</Link> / Approval
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            Review &amp; approve
            <DirectionBadge direction={d} />
          </span>
        }
        subtitle={`${event.title} · ${event.plant} · requested by ${event.requestor}`}
        actions={
          <Button variant="primary" disabled={entries.length === 0 || busy} onClick={() => setConfirm(true)}>
            Approve &amp; close
          </Button>
        }
      />
      {failure && (
        <div className="mb-4">
          <Notice tone="red">{failure}</Notice>
        </div>
      )}
      {entries.length === 0 ? (
        <Notice tone="info">Nothing is waiting for approval on this event.</Notice>
      ) : (
        <div className="grid gap-5">
          <KpiGrid>
            <KpiCard icon="cube" tone="brand" label="Items to approve" value={entries.length} sub={`${negotiated} negotiated · ${entries.length - negotiated} accepted as they stand`} />
            <KpiCard icon="vendors" tone="info" label={d === "buy" ? "Suppliers" : "Scrap buyers"} value={vendorCount} sub="Receiving the order" />
            <KpiCard icon="coin" tone="ok" label="Cost centre" value={event.cost_centre} sub={`${event.purch_org} · ${event.purch_group}`} />
          </KpiGrid>

          <Panel title="Items awaiting approval" flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line2 bg-raise text-left text-xs font-semibold text-muted">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">Sent to</th>
                    <th className="px-4 py-2.5 text-right">Quantity</th>
                    <th className="px-4 py-2.5 text-right">Original</th>
                    <th className="px-4 py-2.5 text-right">Final price</th>
                    <th className="px-4 py-2.5 text-right">{deltaLabel(d)}</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                    <th className="px-4 py-2.5">Terms</th>
                    <th className="px-4 py-2.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const it = e.detail.item;
                    const s = e.session;
                    const active = it.id === current.detail.item.id;
                    const quote = e.detail.comparison.rows.find((r) => r.vendor_id === (s?.vendor_id ?? it.best_bid_vendor_id));
                    return (
                      <tr
                        key={it.id}
                        tabIndex={0}
                        aria-selected={active}
                        onClick={() => setSelected(it.id)}
                        onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setSelected(it.id))}
                        className={`cursor-pointer border-b border-line2 last:border-0 hover:bg-raise ${active ? "bg-brand-soft" : ""}`}
                      >
                        <td className="px-4 py-3 font-semibold text-ink">{it.description}</td>
                        <td className="px-4 py-3">{s?.vendor_name ?? it.best_bid_vendor ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{num(it.qty)} {it.unit}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(s ? s.original_price : it.best_bid)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">{money(s ? s.agreed_price : it.best_bid)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right"><Delta value={s ? s.agreed_delta : 0} direction={d} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(s ? s.agreed_value : it.value)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">{s?.agreed_payment ?? quote?.payment_code ?? "—"} · {quote?.incoterm ?? it.incoterm}</td>
                        <td className="px-4 py-3"><Pill tone={s ? "ok" : "info"}>{s ? "Negotiated" : "As quoted"}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <ItemReview key={current.detail.item.id} entry={current} event={event} />
        </div>
      )}
      <Dialog
        open={confirm}
        title="Approve and close these deals?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={approve}>
              {busy ? "Closing…" : "Approve & close"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {entries.length} item{entries.length === 1 ? "" : "s"} will be closed and the results counted in the dashboard. This cannot be undone.
        </p>
      </Dialog>
    </>
  );
}
