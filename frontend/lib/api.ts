import type { components } from "./api-types";

type S = components["schemas"];

export type Dashboard = S["Dashboard"];
export type EventView = S["EventView"];
export type EventDetail = S["EventDetail"];
export type ItemView = S["ItemView"];
export type ItemRow = S["ItemRow"];
export type ItemDetail = S["ItemDetail"];
export type ComparisonView = S["ComparisonView"];
export type ComparisonRow = S["ComparisonRow"];
export type HistoryView = S["HistoryView"];
export type HistoryRow = S["HistoryRow"];
export type HistoryPoint = S["HistoryPoint"];
export type OutcomeView = S["OutcomeView"];
export type Invitee = S["Invitee"];
export type VendorView = S["VendorView"];
export type VendorDetail = S["VendorDetail"];
export type Kpis = S["Kpis"];

export type SessionView = S["SessionView"];
export type SessionSummary = S["SessionSummary"];
export type TurnView = S["TurnView"];
export type DraftView = S["DraftView"];
export type SessionRow = S["SessionRow"];
export type NewEvent = S["NewEvent"];
export type NewItem = S["NewItem"];
export type EventCategory = {
  key: string;
  label: string;
  direction: Direction;
  kind: string;
  samples: { description: string; unit: NewItem["unit"]; qty: number; reference_price: number }[];
  vendors: { id: string; name: string; rating: number }[];
};
export type EventUser = {
  id: string;
  entity: string;
  sso: string;
  emp_no: string;
  full_name: string;
  email: string;
  role: string;
  role_name: string;
  cost_centre: string;
};
export type EventOptions = {
  users: EventUser[];
  categories: EventCategory[];
  organisations: { direction: Direction; company_id: string; company: string; plant: string; purch_org: string; purch_group: string; cost_centre: string }[];
  requestors: string[];
  incoterms: string[];
  min_vendors: number;
  next_cart_no: string;
};
export type Toughness = S["Toughness"];
export type Strategy = S["Strategy"];
export type VendorSuggestion = {
  id: string;
  name: string;
  rating: number;
  past_deals: number;
  score: number;
  reasons: string[];
  toughness: "unknown" | "flexible" | "firm" | "hard";
  recommended: boolean;
};
export type Mode = SessionView["mode"];

export type Direction = EventView["direction"];
export type EventStatus = EventView["status"];
export type ItemState = ItemView["state"];
export type Recommendation = ItemView["recommendation"];
export type Objective = NonNullable<S["PointsIn"]["objective"]>;

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return loc ? `${loc}: ${d?.msg ?? "invalid"}` : String(d?.msg ?? "invalid");
      })
      .join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init?.body != null ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* keep status text */
    }
    throw new ApiError(res.status, describe(detail, res.statusText));
  }
  return (await res.json()) as T;
}

type Params = Record<string, string | number | boolean | null | undefined>;

function qs(params: Params): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export type DateRange = { from: string; to: string };

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<S["Health"]>("/api/health"),
  dashboard: (r: DateRange) =>
    request<Dashboard>(`/api/dashboard${qs({ date_from: r.from, date_to: r.to })}`),
  events: (p: { q?: string; direction?: string; status?: string; category_key?: string } & Partial<DateRange>) =>
    request<EventView[]>(
      `/api/events${qs({ q: p.q, direction: p.direction, status: p.status, category_key: p.category_key, date_from: p.from, date_to: p.to })}`,
    ),
  event: (id: string) => request<EventDetail>(`/api/events/${id}`),
  vendorSuggestions: (direction: Direction, categoryKey: string, descriptions: string[], categoryLabel?: string) =>
    request<VendorSuggestion[]>(
      `/api/vendor-suggestions?${new URLSearchParams([
        ["direction", direction],
        ["category_key", categoryKey],
        ...(categoryLabel ? [["category_label", categoryLabel] as [string, string]] : []),
        ...descriptions.filter((d) => d.trim()).map((d) => ["q", d.trim()] as [string, string]),
      ])}`,
    ),
  eventOptions: () => request<EventOptions>("/api/event-options"),
  addEvent: (body: NewEvent) => post<EventDetail>("/api/events", body),
  simulate: (direction: Direction) => post<EventDetail>("/api/events/simulate", { direction }),
  items: (p: {
    event_id?: string;
    has_bids?: boolean;
    recommendation?: string;
    direction?: string;
    q?: string;
    date_from?: string;
    date_to?: string;
  }) =>
    request<ItemRow[]>(`/api/items${qs(p)}`),
  item: (id: string) => request<ItemDetail>(`/api/items/${id}`),
  pastDeal: (id: string) => request<S["HistoryDeal"]>(`/api/history/${id}`),
  itemHistory: (id: string) => request<HistoryView>(`/api/items/${id}/history`),
  setPoints: (id: string, body: { target: number; limit: number; objective?: Objective | null }) =>
    request<ItemDetail>(`/api/items/${id}/points`, { method: "PUT", body: JSON.stringify(body) }),
  confirmPoints: (id: string) => post<ItemDetail>(`/api/items/${id}/confirm-points`),
  releaseBids: (id: string, vendorIds?: string[]) =>
    post<ItemDetail>(`/api/items/${id}/release-bids`, { vendor_ids: vendorIds ?? null }),
  analyze: (id: string) => post<ItemDetail>(`/api/items/${id}/analyze`),
  vendors: () => request<VendorView[]>("/api/vendors"),
  vendor: (id: string) => request<VendorDetail>(`/api/vendors/${id}`),
  history: (p: { direction?: string; category_key?: string; q?: string; negotiated?: boolean; limit?: number }) =>
    request<HistoryRow[]>(`/api/history${qs(p)}`),
  negotiations: () => request<SessionRow[]>("/api/negotiations"),
  sessionsForEvent: (eventId: string) => request<SessionSummary[]>(`/api/events/${eventId}/sessions`),
  sessionsForItem: (itemId: string) => request<SessionSummary[]>(`/api/items/${itemId}/sessions`),
  startNegotiation: (itemId: string, body: { vendor_id?: string | null; mode: Mode }) =>
    post<SessionView>(`/api/items/${itemId}/negotiations`, body),
  session: (id: string) => request<SessionView>(`/api/sessions/${id}`),
  setMode: (id: string, mode: Mode) =>
    request<SessionView>(`/api/sessions/${id}/mode`, { method: "PUT", body: JSON.stringify({ mode }) }),
  askQuestion: (id: string, text: string) => post<SessionView>(`/api/sessions/${id}/questions`, { text }),
  setLanguage: (id: string, language: "en" | "hi" | "mr") =>
    request<SessionView>(`/api/sessions/${id}/language`, { method: "PUT", body: JSON.stringify({ language }) }),
  advance: (id: string) => post<SessionView>(`/api/sessions/${id}/advance`),
  approveDraft: (id: string, draftId: string, edit?: { price?: number; payment_code?: string | null; text?: string | null }) =>
    post<SessionView>(`/api/sessions/${id}/drafts/${draftId}/approve`, edit ?? {}),
  discardDraft: (id: string, draftId: string) => post<SessionView>(`/api/sessions/${id}/drafts/${draftId}/discard`),
  sendMessage: (id: string, body: { price: number; payment_code?: string | null; text?: string | null }) =>
    post<SessionView>(`/api/sessions/${id}/messages`, body),
  acceptOffer: (id: string) => post<SessionView>(`/api/sessions/${id}/accept-offer`),
  handBack: (id: string, reason?: string) => post<SessionView>(`/api/sessions/${id}/hand-back`, { reason: reason ?? null }),
  continueNegotiation: (itemId: string) => post<SessionView>(`/api/items/${itemId}/continue`),
  acceptDeal: (itemId: string) => post<ItemDetail>(`/api/items/${itemId}/accept-deal`),
  closeWithoutDeal: (itemId: string) => post<ItemDetail>(`/api/items/${itemId}/close-without-deal`),
  approveEvent: (eventId: string) => post<EventDetail>(`/api/events/${eventId}/approve`),
  exportUrl: (eventId: string) => `${API_BASE}/api/events/${eventId}/export`,
  reset: () => post<S["ResetResult"]>("/api/admin/reset"),
};
