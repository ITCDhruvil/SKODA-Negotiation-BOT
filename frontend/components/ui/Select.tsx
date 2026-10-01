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
 * Themed drop-down (ARIA select-only combobox). Arrow keys move, Enter or Space picks, Escape closes.
 *
 * With `searchable` the list opens with a search bar. With `onAdd` the search bar also ends in a "+" button:
 * pressing it swaps the search bar for a text box (with the placeholder given in `addPlaceholder`) and an
 * enter button, so a value that is not in the list can be typed in and added in the same place.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  compact = false,
  id,
  placement = "bottom",
  searchable = false,
  searchPlaceholder = "Search",
  onAdd,
  addPlaceholder = "Name the new one",
  scroll = true,
}: {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  ariaLabel?: string;
  disabled?: boolean;
  /** Shrink to the content (for filter bars) instead of filling the row. */
  compact?: boolean;
  id?: string;
  /** Open the list above the field (for controls at the bottom of the page). */
  placement?: "bottom" | "top";
  searchable?: boolean;
  searchPlaceholder?: string;
  onAdd?: (text: string) => void;
  addPlaceholder?: string;
  /** Set false to show every option without a scroll bar. */
  scroll?: boolean;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const withBar = searchable || Boolean(onAdd);
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(needle)) : options;
  const selectedAll = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = Math.max(0, shown.findIndex((o) => o.value === value));
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

  // Typing in the search bar starts again from the first match.
  useEffect(() => setActive(0), [needle]);

  const openList = () => {
    setQuery("");
    setAdding(false);
    setDraft("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const focusTrigger = () => root.current?.querySelector<HTMLElement>("button[role=combobox]")?.focus();
  const choose = (i: number) => {
    const o = shown[i];
    if (o) onChange(o.value);
    setOpen(false);
    focusTrigger();
  };
  const submitAdd = () => {
    const text = draft.trim();
    if (text.length < 2) return;
    onAdd?.(text);
    setAdding(false);
    setDraft("");
    setOpen(false);
  };

  const move = (e: KeyboardEvent, fromInput: boolean) => {
    const last = shown.length - 1;
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
        if (open && !fromInput) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open && !fromInput) {
          e.preventDefault();
          setActive(last);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case " ":
        if (!fromInput) {
          e.preventDefault();
          if (open) choose(active);
          else openList();
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          focusTrigger();
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (!fromInput && !withBar && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const ch = e.key.toLowerCase();
          const from = open ? active + 1 : selected + 1;
          const order = [...shown.keys()].map((k) => (k + from) % shown.length);
          const hit = order.find((k) => shown[k].label.toLowerCase().startsWith(ch));
          if (hit != null) {
            if (open) setActive(hit);
            else onChange(shown[hit].value);
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
        aria-activedescendant={open && !withBar ? `${uid}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => move(e, false)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-m border border-line bg-panel px-3 py-2 text-left text-sm text-ink transition hover:border-brand focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{options[selectedAll]?.label ?? ""}</span>
        <Icon name="down" size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute left-0 z-40 w-full rounded-m border border-line bg-panel shadow-card ${placement === "top" ? "bottom-full mb-1" : "mt-1"}`}>
          {withBar && (
            <div className="flex items-center gap-1.5 border-b border-line2 p-2">
              {adding ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitAdd();
                      } else if (e.key === "Escape") {
                        setAdding(false);
                        setDraft("");
                      }
                    }}
                    maxLength={60}
                    placeholder={addPlaceholder}
                    aria-label={addPlaceholder}
                    className="min-w-0 flex-1 rounded-m border border-brand bg-panel px-3 py-2 text-sm text-ink outline-none placeholder:text-muted"
                  />
                  <button type="button" aria-label="Add" title="Add" disabled={draft.trim().length < 2} onClick={submitAdd} className="grid h-9 w-9 shrink-0 place-items-center rounded-m bg-brand text-on-brand disabled:opacity-40">
                    <Icon name="enter" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Back to search"
                    title="Back to search"
                    onClick={() => {
                      setAdding(false);
                      setDraft("");
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-m text-muted hover:bg-raise"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </>
              ) : (
                <>
                  <label className="flex min-w-0 flex-1 items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 focus-within:border-brand">
                    <Icon name="search" size={15} className="text-muted" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => move(e, true)}
                      placeholder={searchPlaceholder}
                      aria-label={searchPlaceholder}
                      aria-controls={listId}
                      aria-activedescendant={`${uid}-opt-${active}`}
                      className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                    />
                  </label>
                  {onAdd && (
                    <button
                      type="button"
                      aria-label="Add new"
                      title="Add new"
                      onClick={() => {
                        setAdding(true);
                        setDraft(query.trim());
                      }}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-m border border-line text-brand hover:border-brand hover:bg-brand-soft"
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <ul ref={list} id={listId} role="listbox" aria-label={ariaLabel} className={`py-1 ${scroll ? "max-h-64 overflow-auto" : ""}`}>
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault(); // inside a <label>, a click would otherwise re-activate the trigger
                    choose(i);
                  }}
                  className={`flex cursor-pointer items-start justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-brand-soft text-ink" : "text-text"} ${isSel ? "font-semibold" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <Marquee text={o.label} play={i === active} />
                    {o.hint && <Marquee text={o.hint} play={i === active} className="text-xs font-normal text-muted" />}
                  </span>
                  {isSel && <Icon name="check" size={16} className="mt-0.5 shrink-0 text-brand" />}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted">
                No match{onAdd ? ". Use + to add it." : "."}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
