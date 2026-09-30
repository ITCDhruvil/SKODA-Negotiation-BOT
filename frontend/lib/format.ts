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

export const pct = (v: number | null | undefined, digits = 1): string =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
