"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export type SelectOption<V extends string = string> = { value: V; label: string; hint?: string };

/** One line of text, cut off with an ellipsis; while `play` is on it slides right to left to reveal the rest. */
function Marquee({ text, play, className = "" }: { text: string; play: boolean; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!play || !box.current || !inner.current) {
      setShift(0);
      return;
    }
    setShift(Math.max(0, inner.current.scrollWidth - box.current.clientWidth));
  }, [play, text]);
  const style: CSSProperties | undefined =
    shift > 0 ? ({ "--shift": `-${shift}px`, animationDuration: `${Math.max(2.5, shift / 40 + 1.5)}s` } as CSSProperties) : undefined;
  return (
    <span ref={box} className={`block overflow-hidden whitespace-nowrap ${shift === 0 ? "text-ellipsis" : ""} ${className}`} title={text}>
      <span ref={inner} className={`inline-block ${shift > 0 ? "marquee-run" : ""}`} style={style}>
        {text}
      </span>
    </span>
  );
}

/**
 * Themed drop-down (ARIA select-only combobox). Arrow keys move, Enter or Space picks, Escape closes,
 * typing a letter jumps to the next option that starts with it.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  compact = false,
  id,
}: {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  ariaLabel?: string;
  disabled?: boolean;
  /** Shrink to the content (for filter bars) instead of filling the row. */
  compact?: boolean;
  id?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(selected);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    setActive(selected);
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    root.current?.querySelector("button")?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => Math.min(last, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => Math.max(0, a - 1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(last);
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const ch = e.key.toLowerCase();
          const from = open ? active + 1 : selected + 1;
          const order = [...options.keys()].map((k) => (k + from) % options.length);
          const hit = order.find((k) => options[k].label.toLowerCase().startsWith(ch));
          if (hit != null) {
            if (open) setActive(hit);
            else onChange(options[hit].value);
          }
        }
    }
  };

  return (
    <div ref={root} className={`relative ${compact ? "inline-block" : "block w-full"}`}>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${uid}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-m border border-line bg-panel px-3 py-2 text-left text-sm text-ink transition hover:border-brand focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{options[selected]?.label ?? ""}</span>
        <Icon name="down" size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 z-40 mt-1 max-h-64 w-full overflow-auto rounded-m border border-line bg-panel py-1 shadow-card"
        >
          {options.map((o, i) => {
            const isSel = i === selected;
            return (
              <li
                key={o.value}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-start justify-between gap-3 px-3 py-2 text-sm ${
                  i === active ? "bg-brand-soft text-ink" : "text-text"
                } ${isSel ? "font-semibold" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <Marquee text={o.label} play={i === active} />
                  {o.hint && <Marquee text={o.hint} play={i === active} className="text-xs font-normal text-muted" />}
                </span>
                {isSel && <Icon name="check" size={16} className="mt-0.5 shrink-0 text-brand" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
