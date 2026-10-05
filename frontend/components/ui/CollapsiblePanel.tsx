"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** A panel whose body folds away when its heading is clicked. The choice is remembered under `storageKey`. */
export function CollapsiblePanel({
  title,
  storageKey,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`panel:${storageKey}`);
      if (saved === "0" || saved === "1") setOpen(saved === "1");
    } catch {
      /* storage may be blocked */
    }
  }, [storageKey]);
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(`panel:${storageKey}`, o ? "0" : "1");
      } catch {
        /* storage may be blocked */
      }
      return !o;
    });
  };
  return (
    <section className="rounded-card border border-line bg-panel shadow-card">
      <h2 className="m-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center justify-between gap-2 rounded-card px-4 py-3.5 text-left text-[15px] font-bold text-ink hover:bg-raise"
        >
          {title}
          <Icon name="down" size={18} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <div id={bodyId} className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden" aria-hidden={!open} inert={!open ? true : undefined}>
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
