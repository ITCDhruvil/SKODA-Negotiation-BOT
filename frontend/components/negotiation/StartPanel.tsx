"use client";

import { Select } from "@/components/ui/Select";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";
import { api, type ItemDetail, type Mode } from "@/lib/api";
import { MODE_HINT, MODE_LABEL, TOUGH_LABEL } from "@/lib/labels";
import { ModeSelect } from "./ModeSelect";
import { NextBestVendors } from "./NextBestVendors";

/** Lets the buyer start a negotiation (or reopen the running one). The buyer always starts it. */
export function StartPanel({ detail }: { detail: ItemDetail }) {
  const router = useRouter();
  const { item, event } = detail;
  const policy = item.policy;
  const [mode, setMode] = useState<Mode>(policy.default_mode);
  const [vendorId, setVendorId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const responded = detail.invitees.filter((i) => i.responded);
  const chosen = responded.find((v) => v.vendor_id === (vendorId || item.best_bid_vendor_id));
  const open = detail.active_session_id;
  const canStart = (item.state === "analyzed" || (item.state === "negotiating" && !open)) && event.eligibility.eligible;

  if (open) {
    return (
      <Button variant="primary" className="w-full" onClick={() => router.push(`/negotiate/${open}`)}>
        Open negotiation workspace
      </Button>
    );
  }
  if (policy.band === "management") {
    return (
      <Notice tone="amber">
        <b>Handled by higher management.</b> {policy.message}
      </Notice>
    );
  }
  if (item.state === "handed_back") {
    return (
      <div className="grid gap-2.5">
        <p className="text-sm font-semibold text-ink">The last negotiation ended without a deal. Try the next-best vendor:</p>
        <NextBestVendors itemId={item.id} vendors={detail.next_vendors} unit={item.unit} />
      </div>
    );
  }
  if (!canStart) {
    return (
      <p className="text-xs text-muted">
        {item.state === "closed" || item.state === "awaiting_approval" || item.state === "result_pending"
          ? "This item already has a result."
          : "Negotiation can start once the quotes are analyzed."}
      </p>
    );
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.startNegotiation(item.id, { vendor_id: vendorId || null, mode });
      router.push(`/negotiate/${s.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Field label="Negotiate with" hint="Defaults to the best quote.">
        <Select
          value={vendorId}
          onChange={setVendorId}
          ariaLabel="Negotiate with"
          options={[
            { value: "", label: "Best quote (recommended)" },
            ...responded.map((v) => ({ value: v.vendor_id, label: v.vendor_name, hint: v.toughness.level === "unknown" ? undefined : TOUGH_LABEL[v.toughness.level] })),
          ]}
        />
      </Field>
      {chosen && chosen.toughness.level !== "unknown" && chosen.toughness.level !== "flexible" && (
        <Notice tone={chosen.toughness.level === "hard" ? "red" : "amber"}>
          <b>{chosen.vendor_name}.</b> {chosen.toughness.note}
        </Notice>
      )}
      <Field label="Who sends the messages?">
        <ModeSelect id="start-mode" value={mode} onChange={setMode} allowAuto={policy.auto_allowed} />
      </Field>
      {mode === "auto" && <Notice tone="amber">{MODE_LABEL.auto}: {MODE_HINT.auto}</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      <Button variant="primary" className="w-full" disabled={busy} onClick={start}>
        {busy ? "Starting…" : "Start negotiation"}
      </Button>
    </div>
  );
}
