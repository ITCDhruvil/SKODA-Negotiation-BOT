"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { initials } from "@/lib/format";
import { useRange } from "@/lib/providers";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/negotiations", label: "Negotiations", icon: "chat" },
  { href: "/vendors", label: "Vendors", icon: "vendors" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/settings", label: "Settings", icon: "ops" },
];

import { USER as PROFILE } from "@/lib/user";

const USER = { name: PROFILE.name, role: `${PROFILE.role} · ${PROFILE.site}` };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/events") return pathname.startsWith("/events") || pathname.startsWith("/items");
  if (href === "/negotiations") return pathname.startsWith("/negotiat");
  return pathname.startsWith(href);
}

const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Main menu", hrefs: ["/", "/events", "/negotiations", "/vendors"] },
  { label: "Others", hrefs: ["/history", "/reports", "/settings"] },
];

function Sidebar({
  pathname,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  pathname: string;
  onNavigate: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[22px] bg-emerald px-3 pb-3 pt-4 text-side-t shadow-card">
      <div className={`flex items-center gap-2.5 pb-4 ${collapsed ? "justify-center" : "px-1"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-electric text-[13px] font-extrabold text-e-ink">NB</span>
        {!collapsed && (
          <div className="min-w-0">
            <b className="block truncate text-base text-white">Negotiation Desk</b>
            <span className="block truncate text-[11.5px] text-side-m">SKODA Auto VW India · POC</span>
          </div>
        )}
      </div>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={`mb-3 flex items-center gap-2.5 rounded-full border border-white/10 py-1.5 text-xs font-medium text-side-m transition hover:bg-white/5 hover:text-white ${collapsed ? "mx-auto h-9 w-9 justify-center" : "px-3"}`}
        >
          <Icon name="chevron" size={14} className={collapsed ? "" : "rotate-180"} />
          {!collapsed && "Collapse"}
        </button>
      )}
      <nav aria-label="Main" className="grid gap-4">
        {GROUPS.map((g) => (
          <div key={g.label} className="grid gap-1">
            {collapsed ? (
              <span aria-hidden className="mx-auto mb-0.5 h-px w-4 bg-white/15" />
            ) : (
              <span className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-side-m">{g.label}</span>
            )}
            {NAV.filter((n) => g.hrefs.includes(n.href)).map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  title={collapsed ? n.label : undefined}
                  aria-label={collapsed ? n.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-full font-medium transition ${collapsed ? "mx-auto h-11 w-11 justify-center" : "py-1.5 pl-1.5 pr-3"} ${
                    active ? "bg-white/15 text-white" : "hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${active ? "bg-electric text-e-ink" : "bg-white/10"}`}>
                    <Icon name={n.icon} size={17} />
                  </span>
                  {!collapsed && n.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="mt-auto border-t border-white/10 pt-3">
        <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : "px-1"}`} title={collapsed ? USER.name : undefined}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-white">{initials(USER.name)}</span>
          {!collapsed && (
            <div className="min-w-0">
              <b className="block truncate text-[13px] text-white">{USER.name}</b>
              <span className="block truncate text-[11.5px] text-side-m">{USER.role}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DateRangeMenu() {
  const { range, setRange } = useRange();
  return <DateRangePicker value={range} onChange={setRange} />;
}

/** The heading for the current page, shown on the left of the top bar. */
function pageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/story") return "Demo story";
  if (pathname.startsWith("/events/") && pathname.endsWith("/approve")) return "Approval";
  if (pathname.startsWith("/events/")) return "Event";
  if (pathname.startsWith("/items/")) return "Item";
  if (pathname.startsWith("/negotiate/")) return "Conversation";
  if (pathname.startsWith("/vendors/")) return "Vendor";
  return NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href))?.label ?? "";
}

function Topbar({ onMenu, menuRef, pathname }: { onMenu: () => void; menuRef: RefObject<HTMLButtonElement>; pathname: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : "/events");
  };
  return (
    <header className="app-topbar sticky top-0 z-20 flex items-center gap-2 border-b border-line2 bg-bg/90 px-4 py-2.5 backdrop-blur md:px-6">
      <button
        ref={menuRef}
        type="button"
        className="grid h-10 w-10 place-items-center rounded-m text-ink hover:bg-raise lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>
      <h1 className="min-w-0 truncate text-xl font-extrabold tracking-tight text-ink">{pageTitle(pathname)}</h1>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <DateRangeMenu />
        <form onSubmit={submit} role="search" className="flex w-40 min-w-0 items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 focus-within:border-brand hover:border-brand sm:w-64 lg:w-80">
          <Icon name="search" size={16} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search event, item, category…"
            aria-label="Search all events"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </form>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("navCollapsed") === "1");
    } catch {
      /* storage may be blocked */
    }
  }, []);
  const toggleNav = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("navCollapsed", c ? "0" : "1");
      } catch {
        /* storage may be blocked */
      }
      return !c;
    });
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
    <div className={`app-grid transition-[grid-template-columns] lg:grid lg:min-h-screen ${collapsed ? "lg:grid-cols-[96px_minmax(0,1fr)]" : "lg:grid-cols-[268px_minmax(0,1fr)]"}`}>
      <aside className="app-aside sticky top-0 hidden h-screen p-3 lg:block">
        <Sidebar pathname={pathname} onNavigate={() => {}} collapsed={collapsed} onToggle={toggleNav} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" onKeyDown={onDrawerKey}>
          <button className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[284px] p-3">
            <Sidebar pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <Topbar onMenu={() => setOpen(true)} menuRef={menuRef} pathname={pathname} />
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
