"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SessionSummary, type SessionView } from "@/lib/api";

/**
 * The full conversations of an item, kept fresh while someone is looking at them. Conversations that run on their own
 * are moved on here, one step at a time, so a buyer who started several vendors sees all of them progress. The one
 * conversation being watched (`watch`) is driven by its own panel at a human pace; it reports back through `update`.
 */
export function useLiveSessions(sessions: SessionSummary[], enabled: boolean, onFinished: () => void) {
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const ids = sessions.map((s) => s.id).join(",");
  const last = useRef<Record<string, string>>({});
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const latest = useRef(views);
  latest.current = views;
  const watching = useRef<string | null>(null);

  const note = useCallback((v: SessionView) => {
    const was = last.current[v.id];
    last.current[v.id] = v.status;
    return was === "active" && v.status !== "active";
  }, []);

  /** A new state of a conversation, from the panel that shows it. */
  const update = useCallback(
    (v: SessionView) => {
      setViews((old) => ({ ...old, [v.id]: v }));
      if (note(v)) finished.current();
    },
    [note],
  );

  const watch = useCallback((id: string | null) => {
    watching.current = id;
  }, []);

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
          const prev = latest.current[s.id];
          // The conversation on screen moves at its own pace and reports its own changes; it is not touched here.
          if (watching.current === s.id && prev) continue;
          let v: SessionView;
          try {
            v = prev && prev.status === "active" && prev.mode === "auto" && prev.actions.can_advance ? await api.advance(s.id) : await api.session(s.id);
          } catch {
            continue;
          }
          next[s.id] = v;
          if (note(v)) ended = true;
        }
        if (live) {
          if (Object.keys(next).length) setViews((old) => ({ ...old, ...next }));
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

  return { views, update, watch };
}
