import type { ReactNode } from "react";
import { Button } from "./basics";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-3 p-2">
      <span className="sr-only">{label}</span>
      {[70, 100, 85].map((w, i) => (
        <div key={i} className="h-4 animate-pulse rounded-s bg-raise" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-m border border-transparent bg-red-soft p-4 text-sm text-red">
      <p className="font-semibold">Could not load data</p>
      <p className="mt-1 break-words">{message}</p>
      <p className="mt-1 text-xs opacity-80">Is the API running? Start it with: python -m uvicorn app.main:app --port 8000</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "amber" | "red" | "ok"; children: ReactNode }) {
  const cls = {
    info: "bg-info-soft text-info",
    amber: "bg-amber-soft text-amber",
    red: "bg-red-soft text-red",
    ok: "bg-ok-soft text-ok",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`rounded-m px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && <div className="mb-1 text-xs text-muted">{crumbs}</div>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
