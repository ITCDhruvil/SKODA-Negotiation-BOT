"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DateRange } from "./api";

type Theme = "light" | "dark";

type ThemeCtx = { theme: Theme; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

type RangeCtx = { range: DateRange; setRange: (r: DateRange) => void };
const RangeContext = createContext<RangeCtx>({ range: { from: "", to: "" }, setRange: () => {} });
export const useRange = () => useContext(RangeContext);

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked; the app still works */
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [range, setRangeState] = useState<DateRange>({ from: "", to: "" });

  useEffect(() => {
    const stored = safeGet("theme");
    const initial: Theme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initial);
    try {
      const saved = JSON.parse(safeGet("range") ?? "null");
      if (saved && typeof saved.from === "string" && typeof saved.to === "string") setRangeState(saved);
    } catch {
      /* ignore a corrupt value */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      safeSet("theme", next);
      return next;
    });
  }, []);

  const setRange = useCallback((r: DateRange) => {
    setRangeState(r);
    safeSet("range", JSON.stringify(r));
  }, []);

  const themeValue = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  const rangeValue = useMemo(() => ({ range, setRange }), [range, setRange]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <RangeContext.Provider value={rangeValue}>{children}</RangeContext.Provider>
    </ThemeContext.Provider>
  );
}
