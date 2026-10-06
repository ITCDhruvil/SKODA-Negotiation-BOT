import type { Direction, EventStatus, ItemState, Objective, Recommendation } from "./api";

export type Tone = "muted" | "ok" | "amber" | "red" | "info" | "brand";

// The single place where the UI names the buy/sell difference. Numbers come from the API.
export const deltaLabel = (d: Direction): string => (d === "buy" ? "Savings" : "Uplift");
export const limitLabel = (d: Direction): string => (d === "buy" ? "Ceiling" : "Floor");
export const bestLabel = (d: Direction): string => (d === "buy" ? "Lowest" : "Highest");
export const partyLabel = (d: Direction): string => (d === "buy" ? "Supplier" : "Scrap buyer");
export const quoteLabel = (d: Direction): string => (d === "buy" ? "Quote" : "Bid");
export const quotesLabel = (d: Direction): string => (d === "buy" ? "Quotes" : "Bids");
export const leadLabel = (d: Direction): string => (d === "buy" ? "Lead time" : "Pickup time");
export const directionText = (d: Direction): string => (d === "buy" ? "BUY" : "SELL");

export const STATE_LABEL: Record<ItemState, string> = {
  draft: "Draft",
  points_reviewed: "Points confirmed",
  awaiting_bids: "Awaiting quotes",
  bids_in: "Quotes in",
  analyzed: "Analyzed",
  negotiating: "Negotiating",
  result_pending: "Result pending",
  awaiting_approval: "Awaiting approval",
  closed: "Closed",
  handed_back: "Handed back",
};

export const STATE_TONE: Record<ItemState, Tone> = {
  draft: "muted",
  points_reviewed: "info",
  awaiting_bids: "amber",
  bids_in: "info",
  analyzed: "brand",
  negotiating: "amber",
  result_pending: "amber",
  awaiting_approval: "info",
  closed: "ok",
  handed_back: "red",
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  closed: "Closed",
};

export const STATUS_TONE: Record<EventStatus, Tone> = {
  received: "info",
  in_progress: "amber",
  closed: "ok",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  waiting: "Waiting for quotes",
  negotiate: "Negotiation recommended",
  accept: "Best quote acceptable",
  review: "Buyer review needed",
  done: "Done",
};

export const RECOMMENDATION_TONE: Record<Recommendation, Tone> = {
  waiting: "muted",
  negotiate: "amber",
  accept: "ok",
  review: "red",
  done: "ok",
};

/** Objective choices for the points form; wording follows the event direction. */
export function objectiveOptions(d: Direction): { value: Objective; label: string }[] {
  return [
    { value: "reduce_price", label: d === "buy" ? "Reduce price" : "Raise price" },
    { value: "improve_lead_time", label: d === "buy" ? "Improve lead time" : "Improve pickup schedule" },
    { value: "improve_payment_terms", label: "Improve payment terms" },
    { value: "improve_commercial_terms", label: "Improve commercial terms" },
  ];
}

/** Lifecycle steps shown on the item page, in order. */
export const STEPS: { key: string; label: string; states: ItemState[] }[] = [
  { key: "points", label: "Points", states: ["draft", "points_reviewed"] },
  { key: "quotes", label: "Quotes", states: ["awaiting_bids", "bids_in"] },
  { key: "analysis", label: "Analysis", states: ["analyzed"] },
  { key: "negotiation", label: "Negotiation", states: ["negotiating", "result_pending", "handed_back"] },
  { key: "approval", label: "Approval", states: ["awaiting_approval"] },
  { key: "closed", label: "Closed", states: ["closed"] },
];

export const MODE_LABEL: Record<"auto" | "approve" | "manual", string> = {
  auto: "Full auto",
  approve: "Approve each message",
  manual: "Manual",
};

export const LANGUAGE_LABEL: Record<"en" | "hi" | "mr", string> = { en: "English", hi: "Hindi (हिंदी)", mr: "Marathi (मराठी)" };

export const TACTIC_LABEL: Record<string, string> = {
  open: "Opening offer",
  concede: "Small step",
  trade: "Terms trade",
  leverage: "Other offers",
  split: "Meet in the middle",
  bluff: "Testing a final price",
  crawl: "Called out small steps",
  close: "Closing ask",
  hold: "Holding firm",
  accept: "Accepting",
  handback: "Handing back",
};

export const TOUGH_LABEL: Record<"unknown" | "flexible" | "firm" | "hard", string> = {
  unknown: "Unknown",
  flexible: "Flexible",
  firm: "Firm",
  hard: "Hard to crack",
};
export const TOUGH_TONE: Record<"unknown" | "flexible" | "firm" | "hard", Tone> = { unknown: "muted", flexible: "ok", firm: "amber", hard: "red" };

export const PHASE_LABEL: Record<string, string> = {
  opening: "Opening",
  probing: "Probing",
  trading: "Trading",
  pressing: "Pressing",
  closing: "Closing",
  done: "Finished",
};

export const STANCE_LABEL: Record<string, string> = { unknown: "Too early to tell", open: "Open", firm: "Firm", open_on_terms: "Open on terms", crawling: "Crawling" };
export const MOOD_LABEL: Record<string, string> = { calm: "Calm", impatient: "Impatient", frustrated: "Frustrated", walking_away: "About to walk away" };
export const MOOD_TONE: Record<string, Tone> = { calm: "ok", impatient: "info", frustrated: "amber", walking_away: "red" };
export const STANCE_TONE: Record<string, Tone> = { unknown: "muted", open: "ok", firm: "red", open_on_terms: "info", crawling: "amber" };

export const MODE_HINT: Record<"auto" | "approve" | "manual", string> = {
  auto: "Messages go out on their own, round by round. You can stop and take over at any time.",
  approve: "Each message is drafted for you; you review, edit and send it.",
  manual: "You write every message yourself.",
};

export const SESSION_TONE: Record<"active" | "agreed" | "handed_back", Tone> = { active: "amber", agreed: "ok", handed_back: "red" };
export const SESSION_LABEL: Record<"active" | "agreed" | "handed_back", string> = {
  active: "In progress",
  agreed: "Agreed",
  handed_back: "Handed back",
};

/** Where a deal stands: agreed after talks, taken as quoted, not finished, or no deal. */
export type DealStatus = "agreed" | "accepted_as_quoted" | "not_finalised" | "disagreed";
export const DEAL_LABEL: Record<DealStatus, string> = {
  agreed: "Agreed",
  accepted_as_quoted: "Accepted as quoted",
  not_finalised: "Not finalised",
  disagreed: "Disagreed",
};
export const DEAL_TONE: Record<DealStatus, Tone> = { agreed: "ok", accepted_as_quoted: "info", not_finalised: "muted", disagreed: "red" };

/** A contract term in months, as a plain phrase: "24 months" or "3 years". */
export function tenureLabel(months?: number | null): string {
  if (!months) return "—";
  return months % 12 === 0 ? `${months / 12} ${months === 12 ? "year" : "years"}` : `${months} months`;
}

/** Who handles a deal of a given size (see the policy in the backend). */
export const BAND_LABEL: Record<"auto" | "supervised" | "management", string> = {
  auto: "Handled by the bot",
  supervised: "You check it",
  management: "Higher management",
};
export const BAND_TONE: Record<"auto" | "supervised" | "management", Tone> = { auto: "ok", supervised: "info", management: "amber" };
