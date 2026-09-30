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
