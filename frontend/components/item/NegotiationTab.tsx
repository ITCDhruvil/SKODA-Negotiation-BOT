"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatLog } from "@/components/negotiation/ChatLog";
import { Button, Pill } from "@/components/ui/basics";
import { Loading, Notice } from "@/components/ui/State";
import { api, type SessionSummary, type SessionView } from "@/lib/api";
import { money } from "@/lib/format";
import { MODE_LABEL, SESSION_LABEL, SESSION_TONE, deltaLabel } from "@/lib/labels";

function SessionCard({ s, defaultOpen }: { s: SessionSummary; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [full, setFull] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || full) return;
    let live = true;
    api
      .session(s.id)
      .then((v) => live && setFull(v))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [open, full, s.id, s.round, s.status]);

  return (
    <div className="rounded-m border border-line2">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{s.vendor_name}</div>
          <div className="text-xs text-muted">
            {MODE_LABEL[s.mode]} · {s.round} round{s.round === 1 ? "" : "s"} · started{" "}
            {new Date(s.started_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        {s.agreed_price != null && <span className="font-bold tabular-nums text-ink">{money(s.agreed_price)}</span>}
        <Pill tone={SESSION_TONE[s.status]}>{SESSION_LABEL[s.status]}</Pill>
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide conversation" : "Show conversation"}
        </Button>
        <Link href={`/negotiate/${s.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
          {s.status === "active" ? "Open workspace" : "Open"}
        </Link>
      </div>
      {open && (
        <div className="border-t border-line2 p-4">
          {error && <Notice tone="red">{error}</Notice>}
          {!full && !error && <Loading label="Loading conversation" />}
          {full && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                <span>Original quote {money(full.original_price)}</span>
                <span>Latest vendor price {money(full.vendor_offer)}</span>
                {full.agreed_delta != null && (
                  <span>
                    {deltaLabel(full.direction)} {money(full.agreed_delta)}
                  </span>
                )}
              </div>
              <div className="max-h-[28rem] overflow-auto">
                <ChatLog turns={full.turns} vendorName={full.vendor_name} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function NegotiationTab({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <Notice tone="info">
        No negotiation on this item yet. Once the quotes are analyzed, start one from the &ldquo;Negotiation opportunity&rdquo; card on the right.
      </Notice>
    );
  }
  const ordered = [...sessions].reverse();
  return (
    <div className="grid gap-3">
      {ordered.map((s, i) => (
        <SessionCard key={s.id} s={s} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
