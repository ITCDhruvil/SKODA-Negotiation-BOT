"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { dateShort, initials } from "@/lib/format";
import { useDismissDetails } from "@/lib/hooks";
import { useRange, useTheme } from "@/lib/providers";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/negotiations", label: "Negotiations", icon: "chat" },
  { href: "/vendors", label: "Vendors", icon: "vendors" },
  { href: "/comparison", label: "Comparison", icon: "comparison" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/ops", label: "Ops", icon: "ops" },
];

const USER = { name: "Dhruvil Patel", role: "Buyer · SAVWIPL Pune" };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/events") return pathname.startsWith("/events") || pathname.startsWith("/items");
  if (href === "/negotiations") return pathname.startsWith("/negotiat");
  return pathname.startsWith(href);
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col bg-emerald px-3 pb-3 pt-[18px] text-side-t">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-electric text-[13px] font-extrabold text-e-ink">
          NB
        </span>
        <div>
          <b className="block text-base text-white">Negotiation Desk</b>
          <span className="block text-[11.5px] text-side-m">SKODA Auto VW India · POC</span>
        </div>
      </div>
      <nav aria-label="Main" className="grid gap-0.5">
        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 font-medium transition ${
                active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              {active && <span className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-r bg-electric" />}
              <Icon name={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-white/10 px-1 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/10 text-xs font-bold text-white">
            {initials(USER.name)}
          </span>
          <div className="min-w-0">
            <b className="block truncate text-[13px] text-white">{USER.name}</b>
            <span className="text-[11.5px] text-side-m">{USER.role}</span>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-side-m">
          Smarter negotiations. Better outcomes. Prices and scrap rates are illustrative POC values.
        </p>
      </div>
    </div>
  );
}

function DateRangeMenu() {
  const { range, setRange } = useRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
  }, [range.from, range.to]);
  const label =
    range.from || range.to
      ? `${range.from ? dateShort(range.from) : "…"} – ${range.to ? dateShort(range.to) : "…"}`
      : "All dates";
  const invalid = Boolean(from && to && from > to);
  const menuRef = useDismissDetails();
  return (
    <details className="relative" ref={menuRef}>
      <summary
        aria-label={`Date range: ${label}`}
        className="flex cursor-pointer list-none items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 text-sm font-medium text-ink hover:border-brand">
        <Icon name="calendar" size={16} />
        <span className="hidden sm:inline">{label}</span>
        <Icon name="down" size={14} />
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 rounded-l border border-line bg-panel p-4 shadow-pop">
        <p className="mb-3 text-xs text-muted">Filter events by the date they were created.</p>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-m border border-line bg-panel px-2 py-1.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-m border border-line bg-panel px-2 py-1.5 text-sm" />
          </label>
          {invalid && <p role="alert" className="text-xs text-red">“From” must not be after “To”.</p>}
          <div className="flex justify-end gap-2">
            <button
              className="rounded-m px-3 py-1.5 text-xs font-semibold text-muted hover:bg-raise"
              onClick={(e) => {
                setRange({ from: "", to: "" });
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              }}
            >
              Clear
            </button>
            <button
              disabled={invalid}
              className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
              onClick={(e) => {
                setRange({ from, to });
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

function Topbar({ onMenu, menuRef }: { onMenu: () => void; menuRef: RefObject<HTMLButtonElement> }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : "/events");
  };
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line2 bg-bg/90 px-4 py-2.5 backdrop-blur md:px-6">
      <button
        ref={menuRef}
        type="button"
        className="grid h-10 w-10 place-items-center rounded-m text-ink hover:bg-raise lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>
      <form onSubmit={submit} role="search" className="flex min-w-0 max-w-xl flex-1 items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 hover:border-brand">
        <Icon name="search" size={16} className="text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search event, item, category…"
          aria-label="Search events"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <DateRangeMenu />
        <button
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="grid h-10 w-10 place-items-center rounded-m border border-transparent text-ink hover:bg-raise"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <span className="hidden h-9 w-9 place-items-center rounded-full bg-emerald text-xs font-bold text-white sm:grid" title={USER.name}>
          {initials(USER.name)}
        </span>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => setOpen(false), [pathname]);

  // Focus moves into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    if (open) {
      drawerRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (wasOpen.current) {
      menuRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const onDrawerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Sidebar pathname={pathname} onNavigate={() => {}} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" onKeyDown={onDrawerKey}>
          <button className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[268px]">
            <Sidebar pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <Topbar onMenu={() => setOpen(true)} menuRef={menuRef} />
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
