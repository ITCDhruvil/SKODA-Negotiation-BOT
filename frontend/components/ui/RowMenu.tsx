"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type RowMenuItem = { label: string; hint: string; href: string; icon: IconName };

const MENU_W = 272;
const ROW_H = 58;

/** A bare three-dot button that opens a small list of links. It sits above the table, so it is never clipped by it. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const toggle = () => {
    if (at) return setAt(null);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const height = items.length * ROW_H + 12;
    const top = r.bottom + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : r.bottom + 4;
    setAt({ left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)), top });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:text-ink focus-visible:text-ink"
      >
        <Icon name="more" size={20} />
      </button>
      {at && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          style={{ position: "fixed", left: at.left, top: at.top, width: MENU_W }}
          className="z-50 rounded-card border border-line bg-panel p-1.5 text-left shadow-card"
        >
          {items.map((it) => (
            <Link
              key={it.label}
              role="menuitem"
              href={it.href}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-3 rounded-m px-2.5 py-2 text-left hover:bg-raise focus-visible:bg-raise focus-visible:outline-none"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-m bg-brand-soft text-brand">
                <Icon name={it.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{it.label}</span>
                <span className="block truncate text-xs text-muted">{it.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
