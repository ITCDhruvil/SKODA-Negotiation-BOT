"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChatLog } from "@/components/negotiation/ChatLog";
import { Button, Delta, Panel } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type ItemView, type SessionView } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel } from "@/lib/labels";

type Entry = { item: ItemView; session: SessionView | null };

async function load(eventId: string): Promise<{ title: string; direction: "buy" | "sell"; entries: Entry[] }> {
  const ev = await api.event(eventId);
  const waiting = ev.items.filter((i) => i.state === "awaiting_approval");
  const entries = await Promise.all(
    waiting.map(async (item): Promise<Entry> => {
      const list = await api.sessionsForItem(item.id);
      const agreed = [...list].reverse().find((x) => x.status === "agreed");
      return { item, session: agreed ? await api.session(agreed.id) : null };
    }),
  );
  return { title: ev.event.title, direction: ev.event.direction, entries };
}

function EntryCard({ e, direction }: { e: Entry; direction: "buy" | "sell" }) {
  const [open, setOpen] = useState(false);
  const { item, session } = e;
  return (
    <Panel
      title={item.description}
      subtitle={session ? session.vendor_name : `Best ${direction === "buy" ? "quote" : "bid"} accepted as it stands: ${item.best_bid_vendor ?? ""}`}
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Quantity", `${num(item.qty)} ${item.unit}`],
          ["Original", money(session ? session.original_price : item.best_bid)],
          ["Final price", money(session ? session.agreed_price : item.best_bid)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted">{deltaLabel(direction)}</dt>
          <dd>
            <Delta value={session ? session.agreed_delta : 0} direction={direction} />
          </dd>
        </div>
      </dl>
      {session && (
        <>
          <Button size="sm" className="mt-4" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide conversation" : "Show conversation"}
          </Button>
          {open && (
            <div className="mt-3 max-h-96 overflow-auto rounded-m border border-line2 p-3">
              <ChatLog turns={session.turns} vendorName={session.vendor_name} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export default function ApprovePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, errorStatus, loading, reload } = useApi(() => load(id), [id]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (loading && !data) return <Loading label="Loading approvals" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;

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
        title="Review & approve"
        subtitle={data.title}
        actions={
          <Button variant="primary" disabled={data.entries.length === 0 || busy} onClick={() => setConfirm(true)}>
            Approve &amp; close
          </Button>
        }
      />
      {failure && (
        <div className="mb-4">
          <Notice tone="red">{failure}</Notice>
        </div>
      )}
      {data.entries.length === 0 ? (
        <Notice tone="info">Nothing is waiting for approval on this event.</Notice>
      ) : (
        <div className="grid gap-5">
          {data.entries.map((e) => (
            <EntryCard key={e.item.id} e={e} direction={data.direction} />
          ))}
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
          {data.entries.length} item{data.entries.length === 1 ? "" : "s"} will be closed and the results counted in the dashboard. This cannot be undone.
        </p>
      </Dialog>
    </>
  );
}
