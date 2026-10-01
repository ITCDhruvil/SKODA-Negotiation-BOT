"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";
import { api, type ItemDetail, type Mode } from "@/lib/api";
import { MODE_HINT, MODE_LABEL } from "@/lib/labels";
import { ModeSelect } from "./ModeSelect";

/** Lets the buyer start a negotiation (or reopen the running one). The buyer always starts it. */
export function StartPanel({ detail }: { detail: ItemDetail }) {
  const router = useRouter();
  const { item, event } = detail;
  const [mode, setMode] = useState<Mode>("approve");
  const [vendorId, setVendorId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const responded = detail.invitees.filter((i) => i.responded);
  const open = detail.active_session_id;
  const canStart = (item.state === "analyzed" || (item.state === "negotiating" && !open)) && event.eligibility.eligible;

  if (open) {
    return (
      <Button variant="primary" className="w-full" onClick={() => router.push(`/negotiate/${open}`)}>
        Open negotiation workspace
      </Button>
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
        <select className={`${inputClass} min-h-[44px]`} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Best quote (recommended)</option>
          {responded.map((v) => (
            <option key={v.vendor_id} value={v.vendor_id}>
              {v.vendor_name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="How much should the assistant do?">
        <ModeSelect id="start-mode" value={mode} onChange={setMode} />
      </Field>
      {mode === "auto" && <Notice tone="amber">{MODE_LABEL.auto}: {MODE_HINT.auto}</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      <Button variant="primary" className="w-full" disabled={busy} onClick={start}>
        {busy ? "Starting…" : "Start negotiation"}
      </Button>
    </div>
  );
}
