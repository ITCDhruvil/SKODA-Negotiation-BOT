// Display formatting only. The frontend never computes money: it renders values from the API.

const IN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const num = (v: number | null | undefined): string => (v == null ? "—" : IN.format(v));

export const money = (v: number | null | undefined): string => (v == null ? "—" : `₹ ${IN.format(v)}`);

/** Indian compact units: lakh (L) and crore (Cr). */
export function moneyCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹ ${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹ ${(v / 1e5).toFixed(2)} L`;
  return money(v);
}

/** Minutes as plain words: "35 minutes", "3 hours 20 min", "1 day 4 hours". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h} hour${h === 1 ? "" : "s"}${r >= 10 ? ` ${r} min` : ""}`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return `${d} day${d === 1 ? "" : "s"}${h > 0 ? ` ${h} hour${h === 1 ? "" : "s"}` : ""}`;
}

export const pct = (v: number | null | undefined, digits = 1): string =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
