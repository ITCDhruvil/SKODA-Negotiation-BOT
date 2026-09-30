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
    setSaved(false);
  }, [item.id, item.target, item.limit, item.objective]);

  const editable = EDITABLE.includes(item.state);
  const canConfirm = item.state === "draft";
  const eligible = detail.value_eligibility.eligible;
  const lim = limitLabel(eventDirection);

  const parsed = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const valid = parsed(target) > 0 && parsed(limit) > 0;

  const run = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.setPoints(item.id, { target: parsed(target), limit: parsed(limit), objective: objective || null });
      if (confirm) await api.confirmPoints(item.id);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Negotiation points" subtitle="You set the targets. The bot never goes beyond your limit.">
      <div className="grid gap-4">
        {!item.points_set && (
          <Notice tone="info">
            Suggested from history: target {money(item.target)}, {lim.toLowerCase()} {money(item.limit)}. Adjust and confirm.
          </Notice>
        )}
        {!eligible && <Notice tone="amber">{detail.value_eligibility.reason}. Points cannot be confirmed for this event.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target price" hint="Per unit">
            <input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label="Target price"
            />
          </Field>
          <Field label={`${lim} (walk-away)`} hint="Never shown to vendors">
            <input
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label={`${lim} price`}
            />
          </Field>
        </div>
        <Field label="Negotiation objective">
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as Objective | "")}
            disabled={!editable || busy}
            className={inputClass}
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
        {!editable && <p className="text-xs text-muted">Points are locked once negotiation has started.</p>}
      </div>
    </Panel>
  );
}
