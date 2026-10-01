import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Direction } from "@/lib/api";
import { deltaLabel, directionText, type Tone } from "@/lib/labels";
import { money } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-raise text-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  amber: "bg-amber-soft text-amber border-transparent",
  red: "bg-red-soft text-red border-transparent",
  info: "bg-info-soft text-info border-transparent",
  brand: "bg-brand-soft text-brand border-transparent",
};

export function Pill({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  return <Pill tone={direction === "buy" ? "info" : "amber"}>{directionText(direction)}</Pill>;
}

export function Money({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{money(value)}</span>;
}

/** A savings/uplift amount: same field for both directions, labelled by direction. */
export function Delta({
  value,
  direction,
  label = false,
}: {
  value: number | null | undefined;
  direction: Direction;
  label?: boolean;
}) {
  if (value == null) return <span className="text-muted">—</span>;
  const good = value > 0;
  return (
    <span className={`tabular-nums font-semibold ${good ? "text-ok" : "text-muted"}`}>
      {money(value)}
      {label && <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(direction)}</span>}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANT = {
  primary: "bg-brand text-on-brand hover:opacity-90 border-transparent",
  secondary: "bg-panel text-ink border-line hover:border-brand",
  ghost: "bg-transparent text-text border-transparent hover:bg-raise",
  danger: "bg-red-soft text-red border-transparent hover:opacity-90",
} as const;

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-m border font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${BUTTON_VARIANT[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "sm",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-m border font-semibold transition ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${BUTTON_VARIANT[variant ?? "secondary"]}`}
    >
      {children}
    </Link>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-l border border-line bg-panel shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "pt-3" : "p-5"}>{children}</div>
    </section>
  );
}

const KPI_ICON_TONE: Record<Tone, string> = {
  muted: "bg-raise text-muted",
  ok: "bg-ok-soft text-ok",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
};

export function KpiCard({
  icon,
  tone = "brand",
  label,
  value,
  sub,
}: {
  icon: IconName;
  tone?: Tone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-l border border-line bg-panel p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-m ${KPI_ICON_TONE[tone]}`}>
          <Icon name={icon} size={20} />
        </span>
        <span className="text-sm font-medium text-muted">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-extrabold tracking-tight text-ink tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-m border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";
