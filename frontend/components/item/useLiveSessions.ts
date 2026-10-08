"use client";

import { useEffect, useRef, useState } from "react";
import { api, type SessionSummary, type SessionView } from "@/lib/api";

/**
 * The full conversations of an item, kept fresh while someone is looking at them. Conversations that run
 * on their own are moved on here, one step at a time, so a buyer who started several vendors sees them talk.
 */
export function useLiveSessions(sessions: SessionSummary[], enabled: boolean, onFinished: () => void) {
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const ids = sessions.map((s) => s.id).join(",");
  const last = useRef<Record<string, string>>({});
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const latest = useRef(views);
  latest.current = views;

  useEffect(() => {
    if (!enabled || sessions.length === 0) return;
    let live = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const next: Record<string, SessionView> = {};
        let ended = false;
        for (const s of sessions) {
          let v: SessionView;
          try {
            const prev = latest.current[s.id];
            v = prev && prev.status === "active" && prev.mode === "auto" && prev.actions.can_advance ? await api.advance(s.id) : await api.session(s.id);
          } catch {
            continue;
          }
          next[s.id] = v;
          const was = last.current[s.id];
          if (was === "active" && v.status !== "active") ended = true;
          last.current[s.id] = v.status;
        }
        if (live) {
          setViews((old) => ({ ...old, ...next }));
          if (ended) finished.current();
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(t);
    };
    // The list of conversations is the trigger; the views are read through a ref on each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ids]);

  return views;
}
