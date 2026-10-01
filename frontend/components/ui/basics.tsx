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
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-card border border-line bg-panel shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-bold text-ink">{title}</h2>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "pt-2.5" : "p-4"}>{children}</div>
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

/**
 * Summary tile: a large icon on the left, then the label, the value and a line of smaller facts.
 * With `href` the whole tile is a link to the data behind it.
 */
export function KpiCard({
  icon,
  tone = "brand",
  label,
  value,
  facts,
  sub,
  href,
}: {
  icon: IconName;
  tone?: Tone;
  label: string;
  value: ReactNode;
  /** Smaller figures shown under the value, for example "81 open". */
  facts?: string[];
  /** A single line of detail, for tiles that do not need separate figures. */
  sub?: ReactNode;
  href?: string;
}) {
  const body = (
    <div className="flex h-full min-w-0 items-center gap-3.5 p-4">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-m ${KPI_ICON_TONE[tone]}`}>
        <Icon name={icon} size={26} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-muted">{label}</div>
        <div className="truncate text-2xl font-extrabold leading-tight tracking-tight text-ink tabular-nums">{value}</div>
        {sub && !facts && <div className="mt-1 text-[11px] leading-snug text-muted">{sub}</div>}
        {facts && facts.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {facts.map((f, i) => (
              <span key={i} className="whitespace-nowrap">
                {i > 0 && <span aria-hidden="true" className="mr-2">·</span>}
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
      {href && <Icon name="chevron" size={16} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />}
    </div>
  );
  const shell = "min-w-0 overflow-hidden rounded-card border border-line bg-panel shadow-card";
  return href ? (
    <Link href={href} className={`group block ${shell} transition hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
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
