"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Button, DirectionBadge, Field, Panel, inputClass } from "@/components/ui/basics";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { ErrorBox, Loading, Notice } from "@/components/ui/State";
import { api, type Direction, type EventOptions, type NewEvent, type NewItem } from "@/lib/api";
import { num } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type ItemRow = { description: string; qty: string; unit: NewItem["unit"]; price: string; incoterm: string; days: string };

const STEPS = ["Details", "Items", "Vendors", "Review"] as const;
const BUY_UNITS: NewItem["unit"][] = ["EA", "AU", "LOT"];
const SELL_UNITS: NewItem["unit"][] = ["KG", "TON"];

const blankItem = (d: Direction): ItemRow => ({ description: "", qty: "", unit: d === "buy" ? "EA" : "KG", price: "", incoterm: "", days: "" });
const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;

function Form({ options }: { options: EventOptions }) {
  const router = useRouter();
  const params = useSearchParams();
  const [direction, setDirection] = useState<Direction>(params.get("type") === "sell" ? "sell" : "buy");
  const [step, setStep] = useState(0);
  const cats = useMemo(() => options.categories.filter((c) => c.direction === direction), [options, direction]);
  const orgs = useMemo(() => options.organisations.filter((o) => o.direction === direction), [options, direction]);
  const [categoryKey, setCategoryKey] = useState("");
  const [orgIdx, setOrgIdx] = useState("0");
  const [title, setTitle] = useState("");
  const [requestor, setRequestor] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const [due, setDue] = useState("");
  const [cartNo, setCartNo] = useState("");
  const [items, setItems] = useState<ItemRow[]>([blankItem(direction)]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new type starts the form over with that type's defaults.
  useEffect(() => {
    setCategoryKey(cats[0]?.key ?? "");
    setOrgIdx("0");
    setItems([blankItem(direction)]);
    setPicked([]);
    setStep(0);
  }, [direction, cats]);
  const org = orgs[Number(orgIdx)] ?? orgs[0];
  useEffect(() => setCostCentre(org?.cost_centre ?? ""), [org]);
  const category = cats.find((c) => c.key === categoryKey);
  useEffect(() => setPicked(category ? category.vendors.map((v) => v.id) : []), [category]);

  const detailsOk = Boolean(category && org && requestor.trim().length >= 2 && costCentre.trim().length >= 3 && due);
  const itemsOk = items.length > 0 && items.every((i) => i.description.trim().length >= 2 && positive(i.qty) && positive(i.price));
  const vendorsOk = picked.length >= options.min_vendors;
  const ok = [detailsOk, itemsOk, vendorsOk, true];

  const setItem = (idx: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const sampleItem = (c: number) => {
    const s = category?.samples[c];
    if (!s) return;
    setItems([{ description: s.description, qty: String(s.qty), unit: s.unit, price: String(s.reference_price), incoterm: "", days: "" }]);
  };

  const submit = async () => {
    if (!org || !category) return;
    setBusy(true);
    setError(null);
    const body: NewEvent = {
      direction,
      title: title.trim() || null,
      category_key: category.key,
      company_id: org.company_id,
      company: org.company,
      plant: org.plant,
      purch_org: org.purch_org,
      purch_group: org.purch_group,
      requestor: requestor.trim(),
      cost_centre: costCentre.trim(),
      due,
      source_cart_no: cartNo.trim() || null,
      vendor_ids: picked,
      items: items.map((i) => ({
        description: i.description.trim(),
        qty: Number(i.qty),
        unit: i.unit,
        reference_price: Number(i.price),
        incoterm: i.incoterm || null,
        delivery_days: i.days.trim() === "" ? null : Number(i.days),
      })),
    };
    try {
      const res = await api.addEvent(body);
      router.push(`/events/${res.event.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const unitOptions = (direction === "buy" ? BUY_UNITS : SELL_UNITS).map((u) => ({ value: u, label: u }));

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step && !ok.slice(0, i).every(Boolean)}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center justify-center gap-2 rounded-card border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${i === step ? "border-brand bg-brand-soft text-ink" : "border-line bg-panel text-muted hover:border-brand"}`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i < step ? "bg-ok text-white" : i === step ? "bg-brand text-on-brand" : "bg-raise text-muted"}`}>
                {i < step ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel title="Event details">
          <div className="grid gap-4">
            <div className="inline-flex w-fit rounded-m border border-line bg-raise p-0.5" role="group" aria-label="Event type">
              {(["buy", "sell"] as const).map((d) => (
                <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)} className={`rounded-chip px-4 py-2 text-sm font-semibold ${direction === d ? "bg-panel text-brand shadow-card" : "text-muted hover:text-ink"}`}>
                  {d === "buy" ? "Purchase cart" : "Scrap lot"}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Category">
                <Select value={categoryKey} onChange={setCategoryKey} ariaLabel="Category" options={cats.map((c) => ({ value: c.key, label: c.label }))} />
              </Field>
              <Field label="Event title" hint="Optional. Leave empty to use the first item.">
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              </Field>
              <Field label="Plant and purchasing group">
                <Select
                  value={orgIdx}
                  onChange={setOrgIdx}
                  ariaLabel="Plant and purchasing group"
                  options={orgs.map((o, i) => ({ value: String(i), label: `${o.plant} · ${o.purch_group}`, hint: `${o.company} · ${o.purch_org}` }))}
                />
              </Field>
              <Field label="Requestor">
                <input className={inputClass} list="requestors" value={requestor} onChange={(e) => setRequestor(e.target.value)} maxLength={60} />
                <datalist id="requestors">
                  {options.requestors.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </Field>
              <Field label="Cost centre">
                <input className={inputClass} value={costCentre} onChange={(e) => setCostCentre(e.target.value)} maxLength={20} inputMode="numeric" />
              </Field>
              <Field label="Needed by">
                <input type="date" className={inputClass} value={due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} />
              </Field>
              {direction === "buy" && (
                <Field label="Shopping cart number" hint="Optional. A number is generated if left empty.">
                  <input className={inputClass} value={cartNo} onChange={(e) => setCartNo(e.target.value.replace(/\D/g, ""))} maxLength={20} inputMode="numeric" />
                </Field>
              )}
            </div>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel
          title={direction === "buy" ? "Items in the cart" : "The scrap lot"}
          actions={
            <>
              {category?.samples.slice(0, 3).map((s, i) => (
                <Button key={s.description} size="sm" onClick={() => sampleItem(i)} title="Fill from a sample">
                  {s.description}
                </Button>
              ))}
            </>
          }
        >
          <div className="grid gap-3">
            {items.map((it, idx) => (
              <div key={idx} className="grid gap-3 rounded-m border border-line2 p-3 md:grid-cols-[minmax(0,2fr)_110px_110px_130px_auto]">
                <Field label={`Item ${idx + 1}`}>
                  <input className={inputClass} list="item-samples" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="What is needed" maxLength={120} />
                </Field>
                <Field label="Quantity">
                  <input className={inputClass} inputMode="decimal" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <Select value={it.unit} onChange={(u) => setItem(idx, { unit: u })} ariaLabel="Unit" options={unitOptions} />
                </Field>
                <Field label={`Price per ${it.unit}`} hint="Reference price">
                  <input className={inputClass} inputMode="decimal" value={it.price} onChange={(e) => setItem(idx, { price: e.target.value })} />
                </Field>
                {direction === "buy" && items.length > 1 && (
                  <div className="flex items-end">
                    <Button aria-label={`Remove item ${idx + 1}`} onClick={() => setItems((r) => r.filter((_, i) => i !== idx))}>
                      <Icon name="close" size={14} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <datalist id="item-samples">
              {category?.samples.map((s) => (
                <option key={s.description} value={s.description} />
              ))}
            </datalist>
            {direction === "buy" && items.length < 20 && (
              <div>
                <Button onClick={() => setItems((r) => [...r, blankItem(direction)])}>
                  <Icon name="plus" size={14} /> Add an item
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      {step === 2 && category && (
        <Panel
          title="Vendors to invite"
          actions={
            <>
              <Button size="sm" onClick={() => setPicked(category.vendors.map((v) => v.id))}>Select all</Button>
              <Button size="sm" onClick={() => setPicked([])}>Clear</Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-muted">
            Vendors that deal in this category. Invite at least {options.min_vendors}; <b className="text-ink">{picked.length}</b> selected.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {category.vendors.map((v) => {
              const on = picked.includes(v.id);
              return (
                <li key={v.id}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-m border px-3 py-2.5 text-sm transition ${on ? "border-brand bg-brand-soft" : "border-line hover:border-brand"}`}>
                    <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== v.id) : [...p, v.id]))} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{v.name}</span>
                    <span className="text-xs text-muted">Rating {v.rating.toFixed(1)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {step === 3 && category && org && (
        <Panel title="Review">
          <div className="grid gap-4 md:grid-cols-2">
            <dl className="grid text-sm">
              {([
                ["Type", <DirectionBadge key="d" direction={direction} />],
                ["Category", category.label],
                ["Title", title.trim() || items[0]?.description || "—"],
                ["Plant", `${org.plant} · ${org.company}`],
                ["Purchasing", `${org.purch_org} · ${org.purch_group}`],
                ["Requestor", requestor.trim().toUpperCase()],
                ["Cost centre", costCentre],
                ["Needed by", due],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line2 py-2 last:border-0">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid content-start gap-3">
              <div>
                <h3 className="mb-1 text-sm font-bold text-ink">Items</h3>
                <ul className="grid gap-1 text-sm">
                  {items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-3 border-b border-line2 pb-1 last:border-0">
                      <span className="truncate text-text">{i.description}</span>
                      <span className="shrink-0 tabular-nums text-muted">{num(Number(i.qty))} {i.unit} at ₹ {num(Number(i.price))}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-bold text-ink">Invited vendors ({picked.length})</h3>
                <p className="text-sm text-muted">{category.vendors.filter((v) => picked.includes(v.id)).map((v) => v.name).join(", ")}</p>
              </div>
              <Notice tone="info">After you create the event the vendors can be asked to respond, and the event follows the normal flow. Whether it is eligible for negotiation is checked on its page.</Notice>
            </div>
          </div>
        </Panel>
      )}

      {error && <Notice tone="red">{error}</Notice>}

      <div className="flex items-center justify-between gap-3">
        <Link href="/events" className="rounded-m px-3 py-2 text-sm font-semibold text-muted hover:bg-raise">Cancel</Link>
        <div className="flex gap-2">
          <Button disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
            <Icon name="back" size={14} /> Back
          </Button>
          {step < 3 ? (
            <Button variant="primary" disabled={!ok[step]} onClick={() => setStep((s) => s + 1)}>
              Next <Icon name="chevron" size={14} />
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Creating…" : "Create event"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewEventInner() {
  const { data, error, errorStatus, loading, reload } = useApi(() => api.eventOptions(), []);
  if (loading && !data) return <Loading label="Loading the form" />;
  if (error && !data) return <ErrorBox message={error} status={errorStatus} onRetry={reload} />;
  if (!data) return null;
  return <Form options={data} />;
}

export default function NewEventPage() {
  return (
    <Suspense fallback={<Loading label="Loading the form" />}>
      <NewEventInner />
    </Suspense>
  );
}
