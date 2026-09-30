"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  /** HTTP status of the failed request, or null for a network failure or no error. */
  errorStatus: number | null;
  loading: boolean;
  reload: () => Promise<void>;
};

type Loaded<T> = {
  data: T | null;
  error: string | null;
  errorStatus: number | null;
  loading: boolean;
  deps: unknown[];
};

const sameDeps = (a: unknown[], b: unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Fetch on mount and whenever `deps` change. Stale responses are ignored.
 * A change of `deps` drops the previous data at once (another event never shows the last one);
 * `reload()` keeps the current data while it refetches.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, errorStatus: null, loading: true, deps });
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) =>
      sameDeps(s.deps, deps)
        ? { ...s, loading: true }
        : { data: null, error: null, errorStatus: null, loading: true, deps },
    );
    try {
      const data = await fetcherRef.current();
      if (id === seq.current) setState({ data, error: null, errorStatus: null, loading: false, deps });
    } catch (e) {
      if (id === seq.current) {
        setState((s) => ({
          data: sameDeps(s.deps, deps) ? s.data : null,
          error: e instanceof Error ? e.message : String(e),
          errorStatus: e instanceof ApiError ? e.status : null,
          loading: false,
          deps,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  // In the render right after `deps` changed the effect has not run yet: hide the old result.
  const shown: Loaded<T> = sameDeps(state.deps, deps)
    ? state
    : { data: null, error: null, errorStatus: null, loading: true, deps };
  return { data: shown.data, error: shown.error, errorStatus: shown.errorStatus, loading: shown.loading, reload: load };
}

/** Ref for a `<details>` menu that closes on Escape (focus back to its summary) and on a click outside. */
export function useDismissDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== "Escape" || !el?.open) return;
      el.removeAttribute("open");
      el.querySelector("summary")?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.removeAttribute("open");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, []);
  return ref;
}
