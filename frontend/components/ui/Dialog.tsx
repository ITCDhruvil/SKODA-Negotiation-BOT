"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal dialog: focus moves in, Tab stays inside, Escape closes, focus returns to the opener. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = box.current;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full ${size === "lg" ? "max-w-3xl" : "max-w-lg"} overflow-auto rounded-card border border-line bg-panel shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)]`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line2 px-5 py-4">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-m text-muted hover:bg-raise">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line2 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}
