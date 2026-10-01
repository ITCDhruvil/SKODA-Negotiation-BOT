"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, DirectionBadge, inputClass } from "@/components/ui/basics";
import { Avatar } from "@/components/ui/charts";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { SearchBox } from "@/components/ui/TableToolbar";
import { ErrorBox, Loading, Notice } from "@/components/ui/State";
import { api, type Direction, type EventOptions, type EventUser, type NewEvent, type NewItem, type VendorSuggestion } from "@/lib/api";
import { Pill } from "@/components/ui/basics";
import { TOUGH_LABEL, TOUGH_TONE } from "@/lib/labels";
import { num } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type ItemRow = { description: string; qty: string; unit: NewItem["unit"]; price: string };

const STEPS = [
  { key: "details", label: "Details", hint: "What and who" },
  { key: "items", label: "Items", hint: "Quantities and prices" },
  { key: "vendors", label: "Vendors", hint: "Who to invite" },
  { key: "review", label: "Review", hint: "Check and create" },
] as const;
const BUY_UNITS: NewItem["unit"][] = ["EA", "AU", "LOT"];
const SELL_UNITS: NewItem["unit"][] = ["KG", "TON"];

const blankItem = (d: Direction): ItemRow => ({ description: "", qty: "", unit: d === "buy" ? "EA" : "KG", price: "" });
const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;
const todayIso = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const pickOne = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const shuffled = <T,>(xs: T[]): T[] => [...xs].sort(() => Math.random() - 0.5);

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Labeled({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <span className="font-semibold text-ink">
        {label} {required && <span className="text-red" aria-hidden="true">*</span>}
      </span>
      {children}
      {error ? <span role="alert" className="text-xs text-red">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

function Form({ options }: { options: EventOptions }) {
  const router = useRouter();
  const params = useSearchParams();
  const [direction, setDirection] = useState<Direction>(params.get("type") === "sell" ? "sell" : "buy");
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [customCats, setCustomCats] = useState<EventOptions["categories"]>([]);
  const cats = useMemo(() => [...options.categories.filter((c) => c.direction === direction), ...customCats.filter((c) => c.direction === direction)], [options, direction, customCats]);
  // The vendors a typed-in category can invite: every vendor already listed for that kind of event.
  const everyVendor = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; rating: number }>();
    options.categories.filter((c) => c.direction === direction).forEach((c) => c.vendors.forEach((v) => seen.set(v.id, v)));
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [options, direction]);
  const removeCategory = (key: string) => {
    setCustomCats((rows) => rows.filter((c) => c.key !== key));
    if (categoryKey === key) setCategoryKey(options.categories.find((c) => c.direction === direction)?.key ?? "");
  };
  const addCategory = (label: string) => {
    const key = `custom:${label}`;
    if (!cats.some((c) => c.key === key)) {
      setCustomCats((rows) => [...rows, { key, label: direction === "sell" ? `Scrap - ${label}` : `Custom - ${label}`, direction, kind: direction === "sell" ? "scrap" : "goods", samples: [], vendors: everyVendor }]);
    }
    setCategoryKey(key);
  };
  const orgs = useMemo(() => options.organisations.filter((o) => o.direction === direction), [options, direction]);
  const [categoryKey, setCategoryKey] = useState("");
  const [orgIdx, setOrgIdx] = useState("0");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [requestorId, setRequestorId] = useState("");
  const [customUsers, setCustomUsers] = useState<EventUser[]>([]);
  const [costCentre, setCostCentre] = useState("");
  const [due, setDue] = useState(inDays(14));
  const [cartNo, setCartNo] = useState(options.next_cart_no);
  const [items, setItems] = useState<ItemRow[]>([blankItem(direction)]);
  const [picked, setPicked] = useState<string[]>([]);
  const [vq, setVq] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [suggestions, setSuggestions] = useState<VendorSuggestion[] | null>(null);
  const [customised, setCustomised] = useState(false); // the buyer changed the vendor selection by hand

  // A new type starts the form over with that type's defaults.
  useEffect(() => {
    setCategoryKey(options.categories.find((c) => c.direction === direction)?.key ?? "");
    setOrgIdx("0");
    setItems([blankItem(direction)]);
    setPicked([]);
    setStep(0);
    setAttempted(false);
    setCustomised(false);
    setSuggestions(null);
    setTitle("");
    setTitleTouched(false);
    setCartNo(options.next_cart_no);
  }, [direction, options]);
  const org = orgs[Number(orgIdx)] ?? orgs[0];

  // The requestors are the people known to the prototype for this entity (plus any typed in here).
  const entity = org?.plant === "Plant Pune" ? "E1" : "E2";
  const people = useMemo(() => [...options.users.filter((u) => u.entity === entity), ...customUsers.filter((u) => u.entity === entity)], [options, entity, customUsers]);
  const person = people.find((u) => u.id === requestorId);
  const requestor = person?.full_name ?? "";
  useEffect(() => {
    if (!people.some((u) => u.id === requestorId)) setRequestorId((people.find((u) => u.role === "INITIATOR") ?? people[0])?.id ?? "");
  }, [people, requestorId]);
  const pickRequestor = (id: string) => {
    setRequestorId(id);
    const u = people.find((x) => x.id === id);
    if (u && u.cost_centre) setCostCentre(u.cost_centre);
  };
  const removeRequestor = (id: string) => setCustomUsers((rows) => rows.filter((u) => u.id !== id)); // the default is picked again if it was selected
  const addRequestor = (name: string) => {
    const id = `custom-${name.toLowerCase().replace(/\s+/g, "-")}`;
    setCustomUsers((rows) => (rows.some((r) => r.id === id) ? rows : [...rows, { id, entity, sso: "", emp_no: "New", full_name: name, email: "", role: "INITIATOR", role_name: "Requestor", cost_centre: costCentre }]));
    setRequestorId(id);
  };
  useEffect(() => setCostCentre(org?.cost_centre ?? ""), [org]);
  const category = cats.find((c) => c.key === categoryKey);
  useEffect(() => {
    if (!filled) setPicked(category ? category.vendors.map((v) => v.id) : []);
    setFilled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Vendors are ranked for the request: the category, the items typed so far, ratings and past dealings.
  const itemKey = items.map((i) => i.description.trim()).join("|");
  useEffect(() => {
    if (!categoryKey) return;
    let live = true;
    api
      .vendorSuggestions(direction, categoryKey.startsWith("custom:") ? "custom" : categoryKey, items.map((i) => i.description), categoryKey.startsWith("custom:") ? categoryKey.slice(7) : undefined)
      .then((r) => {
        if (!live) return;
        setSuggestions(r);
        if (!customised) setPicked(r.filter((x) => x.recommended).map((x) => x.id));
      })
      .catch(() => live && setSuggestions(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, categoryKey, itemKey]);

  const problems = {
    requestor: requestor.trim().length < 2 ? "Choose who is asking for this" : null,
    costCentre: costCentre.trim().length < 3 ? "Enter a cost centre" : null,
    due: !due ? "Pick the date it is needed by" : due < todayIso() ? "That date has passed" : null,
  };
  const detailsOk = Boolean(category && org && !problems.requestor && !problems.costCentre && !problems.due);
  const itemProblem = (i: ItemRow) => ({
    description: i.description.trim().length < 2 ? "Describe the item" : null,
    qty: !positive(i.qty) ? "Enter a quantity above 0" : null,
    price: !positive(i.price) ? "Enter a price above 0" : null,
  });
  const itemsOk = items.length > 0 && items.every((i) => !itemProblem(i).description && !itemProblem(i).qty && !itemProblem(i).price);
  const vendorsOk = picked.length >= options.min_vendors;
  const ok = [detailsOk, itemsOk, vendorsOk, true];

  const setItem = (idx: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const sampleRow = (s: EventOptions["categories"][number]["samples"][number]): ItemRow => ({ description: s.description, qty: String(s.qty), unit: s.unit, price: String(s.reference_price) });
  const addSample = (idx: number) => {
    const s = category?.samples[idx];
    if (!s) return;
    if (direction === "sell") return setItems([sampleRow(s)]);
    setItems((rows) => [...rows.filter((r) => r.description.trim() || r.qty || r.price), sampleRow(s)]);
  };

  const goNext = () => {
    if (!ok[step]) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep((s) => s + 1);
  };

  // Fill the whole form with a believable example and jump to the review.
  const autoFill = () => {
    const cat = pickOne(cats.filter((c) => c.samples.length > 0));
    if (!cat) return;
    const orgChoice = Math.floor(Math.random() * Math.max(orgs.length, 1));
    const chosen = direction === "buy" ? shuffled(cat.samples).slice(0, Math.min(cat.samples.length, 1 + Math.floor(Math.random() * 3))) : [pickOne(cat.samples)];
    const rows: ItemRow[] = chosen.map((s) => ({
      description: s.description,
      unit: s.unit,
      qty: String(direction === "sell" ? 1000 + Math.floor(Math.random() * 70) * 100 : Math.max(1, Math.round(s.qty * (1 + Math.random() * 2)))),
      price: String(Math.round(s.reference_price * (1 + Math.random() * 0.08))),
    }));
    setFilled(true);
    setCategoryKey(cat.key);
    setOrgIdx(String(orgChoice));
    setRequestorId(pickOne(people).id);
    setDue(inDays([7, 10, 14, 21, 30][Math.floor(Math.random() * 5)]));
    setTitle("");
    setTitleTouched(false);
    setCartNo(options.next_cart_no);
    setItems(rows);
    setPicked(cat.vendors.map((v) => v.id)); // replaced by the ranked suggestions as soon as they load
    setCustomised(false);
    setAttempted(false);
    setError(null);
    setStep(3);
  };

  const submit = async () => {
    if (!org || !category) return;
    setBusy(true);
    setError(null);
    const body: NewEvent = {
      direction,
      title: eventTitle || null,
      category_key: category.key.startsWith("custom:") ? "custom" : category.key,
      category_label: category.key.startsWith("custom:") ? category.key.slice(7) : null,
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
      items: items.map((i) => ({ description: i.description.trim(), qty: Number(i.qty), unit: i.unit, reference_price: Number(i.price), incoterm: null, delivery_days: null })),
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
  // A scrap lot is titled "Scrap - ..."; a purchase cart takes its first item's name. Typing a title replaces it.
  const first = items[0];
  const defaultTitle =
    direction === "sell"
      ? first?.description.trim()
        ? `Scrap - ${first.description.trim()}${positive(first.qty) ? ` Lot - ${num(Number(first.qty))} ${first.unit.toLowerCase()}` : ""}`
        : `Scrap - ${(category?.label ?? "").replace(/^Scrap - /, "")}`.trim()
      : first?.description.trim()
        ? first.description.trim() + (items.length > 1 ? ` (+${items.length - 1} more)` : "")
        : "";
  const eventTitle = titleTouched && title.trim() ? title.trim() : defaultTitle;
  const rank = new Map((suggestions ?? []).map((x, i) => [x.id, i]));
  const vendorList = (category?.vendors ?? [])
    .filter((v) => !vq || v.name.toLowerCase().includes(vq.toLowerCase()))
    .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  const err = (e: string | null) => (attempted ? e : null);

  const summary: [string, ReactNode, boolean][] = [
    ["Category", category?.label.replace(/^\d+ - /, "") ?? "—", Boolean(category)],
    ["Plant", org ? `${org.plant}` : "—", Boolean(org)],
    ["Requestor", requestor.trim() ? requestor.trim().toUpperCase() : "—", !problems.requestor],
    ["Needed by", due ? new Date(`${due}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—", !problems.due],
    ["Items", itemsOk ? String(items.length) : "—", itemsOk],
    ["Vendors", picked.length ? `${picked.length} invited` : "—", vendorsOk],
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Add event</h2>
          <p className="text-sm text-muted">Four short steps. Or let it fill in an example and just review it.</p>
        </div>
        <Button onClick={autoFill}>
          <Icon name="bulb" size={16} /> Auto fill example
        </Button>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={i > step && !ok.slice(0, i).every(Boolean)}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${i === step ? "border-brand bg-brand-soft" : "border-line bg-panel hover:border-brand"}`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${i < step ? "bg-ok text-white" : i === step ? "bg-brand text-on-brand" : "bg-raise text-muted"}`}>
                {i < step ? <Icon name="check" size={15} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-bold ${i === step ? "text-ink" : "text-text"}`}>{s.label}</span>
                <span className="block truncate text-xs text-muted">{s.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-card border border-line bg-panel p-5 shadow-card">
          {step === 0 && (
            <div className="grid gap-6">
              <Section title="What is it" hint="The kind of event and what it covers.">
                <div className="inline-flex w-fit rounded-m border border-line bg-raise p-0.5" role="group" aria-label="Event type">
                  {(["buy", "sell"] as const).map((d) => (
                    <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)} className={`rounded-chip px-4 py-2 text-sm font-semibold transition ${direction === d ? "bg-panel text-brand shadow-card" : "text-muted hover:text-ink"}`}>
                      {d === "buy" ? "Purchase cart" : "Scrap lot"}
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Labeled label="Category" required>
                    <Select
                      value={categoryKey}
                      onChange={setCategoryKey}
                      ariaLabel="Category"
                      searchable
                      searchPlaceholder="Search categories"
                      onAdd={addCategory}
                      onRemove={removeCategory}
                      addPlaceholder={direction === "sell" ? "New scrap material, e.g. Zinc dross" : "New category, e.g. Office furniture"}
                      options={cats.map((c) => ({ value: c.key, label: c.label, removable: c.key.startsWith("custom:") }))}
                    />
                  </Labeled>
                  <Labeled label="Event title" hint={direction === "sell" ? "Starts with Scrap and follows the lot. Edit it if you like." : "Follows the first item. Edit it if you like."}>
                    <input className={inputClass} value={titleTouched ? title : defaultTitle} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} maxLength={120} placeholder="For example, Training lunch for batch 12" />
                  </Labeled>
                </div>
              </Section>

              <Section title="Who and where" hint="Taken from the organisation set-up used by existing events.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Labeled label="Plant and purchasing group" required>
                    <Select
                      value={orgIdx}
                      onChange={setOrgIdx}
                      ariaLabel="Plant and purchasing group"
                      options={orgs.map((o, i) => ({ value: String(i), label: `${o.plant} · ${o.purch_group}`, hint: `${o.company} · ${o.purch_org}` }))}
                    />
                  </Labeled>
                  <Labeled label="Cost centre" required error={err(problems.costCentre)}>
                    <input className={`${inputClass} ${err(problems.costCentre) ? "!border-red" : ""}`} value={costCentre} onChange={(e) => setCostCentre(e.target.value)} maxLength={20} inputMode="numeric" />
                  </Labeled>
                  <div className="md:col-span-2">
                    <Labeled label="Requestor" required error={err(problems.requestor)} hint="Who is asking for this. Search the list, or use + to add someone.">
                      <Select
                        value={requestorId}
                        onChange={pickRequestor}
                        ariaLabel="Requestor"
                        searchable
                        searchPlaceholder="Search people or roles"
                        onAdd={addRequestor}
                        onRemove={removeRequestor}
                        addPlaceholder={direction === "sell" ? "New requestor for the scrap sale, e.g. Asha Rao" : "New requestor, e.g. Asha Rao"}
                        options={people.map((u) => ({ value: u.id, label: u.full_name, hint: `${u.emp_no} · ${u.role_name} · cost centre ${u.cost_centre}`, removable: u.id.startsWith("custom-") }))}
                      />
                    </Labeled>
                  </div>
                </div>
              </Section>

              <Section title="When" hint="Vendors are asked to respond before this date.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Labeled label="Needed by" required error={err(problems.due)}>
                    <DatePicker ariaLabel="Needed by" value={due} onChange={setDue} min={todayIso()} invalid={Boolean(err(problems.due))} />
                  </Labeled>
                  {direction === "buy" && (
                    <Labeled label="Shopping cart number" hint="The next free number, filled in for you. Change it if you have your own.">
                      <input className={inputClass} value={cartNo} onChange={(e) => setCartNo(e.target.value.replace(/\D/g, ""))} maxLength={20} inputMode="numeric" placeholder={options.next_cart_no} />
                    </Labeled>
                  )}
                </div>
              </Section>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-5">
              <Section title={direction === "buy" ? "Items in the cart" : "The scrap lot"} hint={direction === "buy" ? "Add every item the vendors should quote on." : "A scrap lot is one material measured by weight."}>
                {category && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-muted">{direction === "buy" ? "Add from examples" : "Start from an example"}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {category.samples.map((s, i) => (
                        <button key={s.description} type="button" onClick={() => addSample(i)} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-text hover:border-brand hover:text-brand">
                          <Icon name="plus" size={12} /> {s.description}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <div className="grid min-w-[34rem] gap-2">
                    <div className="grid grid-cols-[minmax(0,2.4fr)_100px_90px_120px_36px] gap-2 px-1 text-xs font-semibold text-muted">
                      <span>Item</span>
                      <span>Quantity</span>
                      <span>Unit</span>
                      <span>Price per unit (₹)</span>
                      <span />
                    </div>
                    {items.map((it, idx) => {
                      const p = itemProblem(it);
                      return (
                        <div key={idx} className="grid grid-cols-[minmax(0,2.4fr)_100px_90px_120px_36px] items-start gap-2 rounded-m border border-line2 bg-raise/40 p-1.5">
                          <div>
                            <input aria-label={`Item ${idx + 1} description`} className={`${inputClass} ${attempted && p.description ? "!border-red" : ""}`} list="item-samples" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="What is needed" maxLength={120} />
                            {attempted && p.description && <span role="alert" className="text-xs text-red">{p.description}</span>}
                          </div>
                          <div>
                            <input aria-label={`Item ${idx + 1} quantity`} className={`${inputClass} ${attempted && p.qty ? "!border-red" : ""}`} inputMode="decimal" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} />
                            {attempted && p.qty && <span role="alert" className="text-xs text-red">Required</span>}
                          </div>
                          <Select value={it.unit} onChange={(u) => setItem(idx, { unit: u })} ariaLabel={`Item ${idx + 1} unit`} options={unitOptions} />
                          <div>
                            <input aria-label={`Item ${idx + 1} price per unit`} className={`${inputClass} ${attempted && p.price ? "!border-red" : ""}`} inputMode="decimal" value={it.price} onChange={(e) => setItem(idx, { price: e.target.value })} />
                            {attempted && p.price && <span role="alert" className="text-xs text-red">Required</span>}
                          </div>
                          {direction === "buy" && items.length > 1 ? (
                            <button type="button" aria-label={`Remove item ${idx + 1}`} title="Remove" onClick={() => setItems((r) => r.filter((_, i) => i !== idx))} className="grid h-[42px] w-9 place-items-center rounded-m text-muted hover:bg-raise hover:text-red">
                              <Icon name="close" size={15} />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <datalist id="item-samples">
                  {category?.samples.map((s) => (
                    <option key={s.description} value={s.description} />
                  ))}
                </datalist>
                {direction === "buy" && items.length < 20 && (
                  <div>
                    <Button onClick={() => setItems((r) => [...r, blankItem(direction)])}>
                      <Icon name="plus" size={14} /> Add another item
                    </Button>
                  </div>
                )}
              </Section>
            </div>
          )}

          {step === 2 && category && (
            <Section title="Vendors to invite" hint={`Picked for you from the category, the items you entered, ratings and how each vendor has dealt with us. Invite at least ${options.min_vendors}.`}>
              <div className="flex flex-wrap items-center gap-2">
                <SearchBox value={vq} onChange={setVq} placeholder="Search vendors" />
                <Button
                  size="sm"
                  onClick={() => {
                    setPicked((suggestions ?? []).filter((x) => x.recommended).map((x) => x.id));
                    setCustomised(false);
                  }}
                >
                  <Icon name="bulb" size={14} /> Use recommended
                </Button>
                <Button size="sm" onClick={() => { setPicked(category.vendors.map((v) => v.id)); setCustomised(true); }}>Select all</Button>
                <Button size="sm" onClick={() => { setPicked([]); setCustomised(true); }}>Clear</Button>
                <span className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${vendorsOk ? "bg-ok-soft text-ok" : "bg-amber-soft text-amber"}`}>
                  {picked.length} selected{vendorsOk ? "" : ` · need ${options.min_vendors - picked.length} more`}
                </span>
              </div>
              <ul className="grid gap-2">
                {vendorList.map((v) => {
                  const on = picked.includes(v.id);
                  const sg = suggestions?.find((x) => x.id === v.id);
                  return (
                    <li key={v.id}>
                      <label className={`flex cursor-pointer items-start gap-3 rounded-m border px-3 py-3 text-sm transition ${on ? "border-brand bg-brand-soft" : "border-line hover:border-brand"}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => {
                            setPicked((p) => (on ? p.filter((x) => x !== v.id) : [...p, v.id]));
                            setCustomised(true);
                          }}
                        />
                        <Avatar name={v.name} index={Number(v.id.replace(/\D/g, ""))} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink">{v.name}</span>
                            {sg?.recommended && <Pill tone="brand">Recommended</Pill>}
                            {sg && sg.toughness !== "unknown" && <Pill tone={TOUGH_TONE[sg.toughness]}>{TOUGH_LABEL[sg.toughness]}</Pill>}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                            <span>Rating {v.rating.toFixed(1)}</span>
                            {sg?.reasons.map((r) => (
                              <span key={r}>{r}</span>
                            ))}
                          </span>
                        </span>
                        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on ? "border-brand bg-brand text-on-brand" : "border-line"}`} aria-hidden="true">
                          {on && <Icon name="check" size={12} />}
                        </span>
                      </label>
                    </li>
                  );
                })}
                {vendorList.length === 0 && <li className="text-sm text-muted">No vendors match.</li>}
              </ul>
            </Section>
          )}

          {step === 3 && category && org && (
            <div className="grid gap-5">
              <Section title="Review" hint="Check everything, change anything with Edit, then create the event.">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-m border border-line2 p-4">
                    <div className="mb-1 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-ink">Event</h4>
                      <button type="button" onClick={() => setStep(0)} className="text-xs font-semibold text-brand hover:underline">Edit</button>
                    </div>
                    <dl className="grid text-sm">
                      {([
                        ["Type", <DirectionBadge key="d" direction={direction} />],
                        ["Category", category.label],
                        ["Title", eventTitle || "—"],
                        ["Plant", `${org.plant} · ${org.company}`],
                        ["Purchasing", `${org.purch_org} · ${org.purch_group}`],
                        ["Requestor", requestor.trim().toUpperCase()],
                        ["Cost centre", costCentre],
                        ["Needed by", due],
                      ] as [string, ReactNode][]).map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line2 py-1.5 last:border-0">
                          <dt className="text-muted">{k}</dt>
                          <dd className="text-right font-semibold text-ink">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="grid content-start gap-4">
                    <div className="rounded-m border border-line2 p-4">
                      <div className="mb-1 flex items-center justify-between">
                        <h4 className="text-sm font-bold text-ink">Items ({items.length})</h4>
                        <button type="button" onClick={() => setStep(1)} className="text-xs font-semibold text-brand hover:underline">Edit</button>
                      </div>
                      <ul className="grid gap-1 text-sm">
                        {items.map((i, idx) => (
                          <li key={idx} className="flex justify-between gap-3 border-b border-line2 pb-1 last:border-0">
                            <span className="truncate text-text">{i.description}</span>
                            <span className="shrink-0 tabular-nums text-muted">{num(Number(i.qty))} {i.unit} · ₹ {num(Number(i.price))}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-m border border-line2 p-4">
                      <div className="mb-1 flex items-center justify-between">
                        <h4 className="text-sm font-bold text-ink">Invited vendors ({picked.length})</h4>
                        <button type="button" onClick={() => setStep(2)} className="text-xs font-semibold text-brand hover:underline">Edit</button>
                      </div>
                      <p className="text-sm text-muted">{category.vendors.filter((v) => picked.includes(v.id)).map((v) => v.name).join(", ")}</p>
                    </div>
                  </div>
                </div>
              </Section>
            </div>
          )}
        </div>

        <aside className="grid gap-3 lg:sticky lg:top-20" aria-label="Summary">
          <div className="rounded-card border border-line bg-panel p-4 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Your event</h3>
              <DirectionBadge direction={direction} />
            </div>
            <div className="mb-2 truncate text-base font-extrabold text-ink">{eventTitle || "Untitled event"}</div>
            <ul className="grid gap-1.5 text-sm">
              {summary.map(([k, v, done]) => (
                <li key={k} className="flex items-center gap-2 border-b border-line2 pb-1.5 last:border-0 last:pb-0">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${done ? "bg-ok text-white" : "border border-line text-transparent"}`} aria-hidden="true">
                    <Icon name="check" size={10} />
                  </span>
                  <span className="text-muted">{k}</span>
                  <span className="ml-auto min-w-0 truncate text-right font-semibold text-ink">{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <Notice tone="info">The vendors&rsquo; answers are simulated for this demo. You will create them from the event page.</Notice>
        </aside>
      </div>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="flex items-center justify-between gap-3">
        <Link href="/events" className="rounded-m px-3 py-2 text-sm font-semibold text-muted hover:bg-raise">Cancel</Link>
        <div className="flex gap-2">
          <Button disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
            <Icon name="back" size={14} /> Back
          </Button>
          {step < 3 ? (
            <Button variant="primary" onClick={goNext}>
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
