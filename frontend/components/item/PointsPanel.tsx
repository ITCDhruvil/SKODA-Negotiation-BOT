"use client";

import { useEffect, useState } from "react";
import { api, type ItemDetail, type Objective } from "@/lib/api";
import { money } from "@/lib/format";
import { limitLabel, objectiveOptions } from "@/lib/labels";
import { Button, Field, inputClass, Panel } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";

const EDITABLE = ["draft", "points_reviewed", "analyzed", "handed_back"];

export function PointsPanel({
  detail,
  eventDirection,
  onChanged,
}: {
  detail: ItemDetail;
  eventDirection: "buy" | "sell";
  onChanged: () => Promise<void>;
}) {
  const item = detail.item;
  const [target, setTarget] = useState(String(item.target));
  const [limit, setLimit] = useState(String(item.limit));
  const [objective, setObjective] = useState<Objective | "">(item.objective ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTarget(String(item.target));
    setLimit(String(item.limit));
    setObjective(item.objective ?? "");
  }, [item.id, item.target, item.limit, item.objective]);

  // "Points saved." stays until another item is opened or the user edits a field.
  useEffect(() => setSaved(false), [item.id]);

  const editable = EDITABLE.includes(item.state);
  const canConfirm = item.state === "draft";
  const eligible = detail.value_eligibility.eligible;
  const lim = limitLabel(eventDirection);

  const parsed = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const targetOk = parsed(target) > 0;
  const limitOk = parsed(limit) > 0;
  const valid = targetOk && limitOk;
  const lockedMessage =
    item.state === "awaiting_bids" || item.state === "bids_in"
      ? "Points cannot be edited at this stage."
      : "Points are locked once negotiation has started.";
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setSaved(false);
  };
  const problem = <span className="text-red">Enter a positive number</span>;

  const run = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    let persisted = false;
    try {
      await api.setPoints(item.id, { target: parsed(target), limit: parsed(limit), objective: objective || null });
      persisted = true;
      if (confirm) await api.confirmPoints(item.id);
      setSaved(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(persisted ? `Points were saved, but could not be confirmed: ${message}` : message);
    }
    try {
      // The saved points are on the server even when confirming failed: show them.
      if (persisted) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Negotiation points" subtitle="You set the targets. The bot never goes beyond your limit.">
      <div className="grid gap-4">
        {!item.points_set && (
          <Notice tone="info">
            Suggested starting points: target {money(item.target)}, {lim.toLowerCase()} {money(item.limit)}. Adjust and confirm.
          </Notice>
        )}
        {!eligible && <Notice tone="amber">{detail.value_eligibility.reason}. Points cannot be confirmed for this event.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target price" hint={targetOk ? "Per unit" : problem}>
            <input
              inputMode="decimal"
              value={target}
              onChange={edit(setTarget)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label="Target price"
              aria-invalid={!targetOk}
            />
          </Field>
          <Field label={`${lim} (walk-away)`} hint={limitOk ? "Never shown to vendors" : problem}>
            <input
              inputMode="decimal"
              value={limit}
              onChange={edit(setLimit)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label={`${lim} (walk-away)`}
              aria-invalid={!limitOk}
            />
          </Field>
        </div>
        <Field label="Negotiation objective">
          <select
            value={objective}
            onChange={(e) => {
              setObjective(e.target.value as Objective | "");
              setSaved(false);
            }}
            disabled={!editable || busy}
            className={inputClass}
            aria-label="Negotiation objective"
          >
            <option value="">No preference</option>
            {objectiveOptions(eventDirection).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {error && <Notice tone="red">{error}</Notice>}
        {saved && !error && <Notice tone="ok">Points saved.</Notice>}
        <div className="flex flex-wrap gap-2">
          {canConfirm ? (
            <Button variant="primary" disabled={!editable || busy || !valid || !eligible} onClick={() => run(true)}>
              Confirm points
            </Button>
          ) : null}
          <Button disabled={!editable || busy || !valid} onClick={() => run(false)}>
            Save points
          </Button>
        </div>
        {!editable && <p className="text-xs text-muted">{lockedMessage}</p>}
      </div>
    </Panel>
  );
}
