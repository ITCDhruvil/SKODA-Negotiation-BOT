"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type RowMenuItem = {
  label: string;
  hint: string;
  icon: IconName;
  /** A link ... */
  href?: string;
  /** ... or an action. It may be async; an error is shown in the menu. */
  onSelect?: () => void | Promise<void>;
  danger?: boolean;
  /** Ask first, inside the same menu. */
  confirm?: { title: string; text: string; button: string };
};

const MENU_W = 272;
const ROW_H = 58;

/** A bare three-dot button that opens a small list of links. It sits above the table, so it is never clipped by it. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [asking, setAsking] = useState<RowMenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => {
      setAt(null);
      setAsking(null);
      setError("");
    };
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

  const run = async (it: RowMenuItem) => {
    const was = at;
    setBusy(true);
    setError("");
    if (!it.confirm) setAt(null);
    try {
      await it.onSelect?.();
      setAt(null);
      setAsking(null);
    } catch (e) {
      if (!it.confirm) setAt(was);
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const choose = (it: RowMenuItem) => {
    if (it.confirm) {
      setAsking(it);
      setAt((a) => (a ? { ...a, top: Math.max(8, Math.min(a.top, window.innerHeight - 232)) } : a));
      return;
    }
    void run(it);
  };

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
          onClick={(e) => e.stopPropagation()}
          className="z-50 rounded-card border border-line bg-panel p-1.5 text-left shadow-card"
        >
          {asking ? (
            <div className="grid gap-3 p-2.5">
              <div>
                <p className="text-sm font-bold text-ink">{asking.confirm?.title}</p>
                <p className="mt-1 text-xs leading-snug text-muted">{asking.confirm?.text}</p>
              </div>
              {error && <p role="alert" className="text-xs font-semibold text-red">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setAsking(null); setError(""); }} disabled={busy} className="rounded-m border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:border-brand disabled:opacity-60">
                  Cancel
                </button>
                <button type="button" onClick={() => void run(asking)} disabled={busy} className="rounded-m bg-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
                  {busy ? "Working..." : asking.confirm?.button ?? "Confirm"}
                </button>
              </div>
            </div>
          ) : (
            items.map((it) => {
              const body = (
                <>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-m ${it.danger ? "bg-red-soft text-red" : "bg-brand-soft text-brand"}`}>
                    <Icon name={it.icon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${it.danger ? "text-red" : "text-ink"}`}>{it.label}</span>
                    <span className="block truncate text-xs text-muted">{it.hint}</span>
                  </span>
                </>
              );
              const cls = "flex w-full items-center gap-3 rounded-m px-2.5 py-2 text-left hover:bg-raise focus-visible:bg-raise focus-visible:outline-none";
              return it.href ? (
                <Link key={it.label} role="menuitem" href={it.href} onClick={(e) => e.stopPropagation()} className={cls}>
                  {body}
                </Link>
              ) : (
                <button key={it.label} type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); choose(it); }} className={cls}>
                  {body}
                </button>
              );
            })
          )}
          {!asking && error && <p role="alert" className="px-2.5 pb-2 pt-1 text-xs font-semibold text-red">{error}</p>}
        </div>
      )}
    </>
  );
}
