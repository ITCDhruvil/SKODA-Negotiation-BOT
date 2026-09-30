"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/** Fetch on mount and whenever `deps` change. Stale responses are ignored. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (id === seq.current) {
        setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
