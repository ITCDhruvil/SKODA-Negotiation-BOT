"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { api, type Direction } from "@/lib/api";
import { useDismissDetails } from "@/lib/hooks";

/** "Create event" button with a menu for a purchase cart or a scrap lot; opens the new draft event. */
export function CreateEventMenu() {
  const router = useRouter();
  const menuRef = useDismissDetails();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (direction: Direction) => {
    if (busy) return;
    menuRef.current?.removeAttribute("open");
    setBusy(true);
    setError(null);
    try {
      const res = await api.simulate(direction);
      router.push(`/events/${res.event.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <details className="relative" ref={menuRef}>
      <summary
        aria-disabled={busy}
        onClick={(e) => {
          if (busy) e.preventDefault();
        }}
        className={`inline-flex list-none items-center gap-2 rounded-m bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <Icon name="plus" size={16} /> {busy ? "Creating…" : "Create event"}
      </summary>
      <div className="absolute right-0 z-30 mt-2 grid w-60 gap-1 rounded-card border border-line bg-panel p-2 shadow-pop">
        <button className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise" onClick={() => create("buy")}>
          New purchase cart
          <span className="block text-xs font-normal text-muted">Services or goods from suppliers</span>
        </button>
        <button className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise" onClick={() => create("sell")}>
          New scrap lot
          <span className="block text-xs font-normal text-muted">Scrap for bidding buyers</span>
        </button>
        {error && (
          <p role="alert" className="px-3 py-1 text-xs text-red">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
