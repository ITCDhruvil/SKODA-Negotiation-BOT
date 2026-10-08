"use client";

import type { KeyboardEvent, ReactNode } from "react";

export const tabId = (prefix: string, key: string) => `${prefix}-tab-${key}`;
export const panelId = (prefix: string, key: string) => `${prefix}-panel-${key}`;

/**
 * Tab list following the ARIA tab pattern. The caller renders the matching
 * `<div role="tabpanel" id={panelId(idPrefix, value)} aria-labelledby={tabId(idPrefix, value)}>`.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  variant = "line",
}: {
  variant?: "line" | "pill" | "chips";
  tabs: { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  idPrefix: string;
}) {
  const move = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      e.key === "ArrowRight" ? (index + 1) % tabs.length
      : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (target < 0) return;
    e.preventDefault();
    onChange(tabs[target].key);
    document.getElementById(tabId(idPrefix, tabs[target].key))?.focus();
  };
  return (
    <div role="tablist" className={variant === "pill" ? "inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-raise p-1" : variant === "chips" ? "flex flex-wrap gap-2" : "flex gap-1 border-b border-line"}>
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.key)}
            aria-selected={active}
            aria-controls={panelId(idPrefix, t.key)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => move(e, i)}
            className={
              variant === "chips"
                ? `inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    active ? "border-brand bg-brand text-on-brand shadow-card" : "border-line bg-panel text-text hover:border-brand hover:text-brand"
                  }`
                : variant === "pill"
                ? `inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                    active ? "bg-panel text-ink shadow-card" : "text-muted hover:text-ink"
                  }`
                : `-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
                    active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                  }`
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
