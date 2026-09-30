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
}: {
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
    <div role="tablist" className="flex gap-1 border-b border-line">
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
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
