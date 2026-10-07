"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { wakeApi, type DateRange } from "./api";

type Theme = "light" | "dark";

/** `theme` is null until the stored or OS preference is known. */
type ThemeCtx = { theme: Theme | null; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ theme: null, toggle: () => {} });
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(v: string): boolean {
  const t = Date.parse(`${v}T00:00:00Z`);
  return ISO_DATE.test(v) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

const validDay = (v: unknown): v is string => typeof v === "string" && (v === "" || isRealDay(v));

/** A stored range is used only when both ends are empty or real dates and from is not after to. */
function parseRange(raw: string | null): DateRange | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || !validDay(saved.from) || !validDay(saved.to)) return null;
    if (saved.from && saved.to && saved.from > saved.to) return null;
    return { from: saved.from, to: saved.to };
  } catch {
    return null;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [range, setRangeState] = useState<DateRange>({ from: "", to: "" });

  useEffect(() => wakeApi(), []);

  useEffect(() => {
    const stored = safeGet("theme");
    const initial: Theme =
      stored === "dark" || stored === "light" ? stored : "light"; // light unless the user chose dark
    setTheme(initial);
    const saved = parseRange(safeGet("range"));
    if (saved) setRangeState(saved);
  }, []);

  // Until the preference is resolved nothing is written, so the CSS media query keeps deciding.
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    safeSet("theme", next);
  }, [theme]);

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
