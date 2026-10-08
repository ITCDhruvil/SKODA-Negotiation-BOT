import type { SessionView } from "@/lib/api";

/** What a negotiation sends back to the AIS prototype that opened it (the case's supplier session at NB 8). */
export type AisResult = {
  case_no: string; // the AIS case number, which is also this event's number
  sid: string; // the supplier, as AIS knows it
  status: "AGREED" | "FAILED";
  initial: number; // the supplier's first offer for the whole cart
  agreed: number | null;
  last: number; // the supplier's last offer
  payment: string | null;
  rounds: number;
  vendor_ended: boolean;
  msgs: { who: "BOT" | "SUP"; text: string; at: string; lang: string }[];
};

export function buildResult(s: SessionView, status: AisResult["status"]): AisResult {
  return {
    case_no: s.event_id,
    sid: s.vendor_id,
    status,
    initial: s.original_price,
    agreed: status === "AGREED" ? s.agreed_price : null,
    last: s.vendor_offer,
    payment: status === "AGREED" ? s.agreed_payment : null,
    rounds: s.round,
    vendor_ended: s.vendor_ended,
    msgs: s.turns.map((t) => ({ who: t.speaker === "us" ? "BOT" : "SUP", text: t.text, at: t.at, lang: s.language.toUpperCase() })),
  };
}

/** Tell the AIS page around this one. Does nothing when the app is not inside AIS. */
export function sendToAis(result: AisResult): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  window.parent.postMessage({ negResult: result }, "*");
  return true;
}

const sentKey = (id: string) => `ais-sent:${id}`;
export function wasSent(id: string): boolean {
  try {
    return window.sessionStorage.getItem(sentKey(id)) === "1";
  } catch {
    return false;
  }
}
export function markSent(id: string): void {
  try {
    window.sessionStorage.setItem(sentKey(id), "1");
  } catch {
    /* storage may be blocked */
  }
}

/** True when this app is shown inside the AIS prototype. */
export function inAis(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/** Ask the AIS page to open the Negotiation Bot case this event belongs to. */
export function openCaseInAis(caseNo: string): void {
  if (inAis()) window.parent.postMessage({ negOpenCase: { case_no: caseNo } }, "*");
}

/** Tell AIS the buyer has confirmed the result, so it reads it at once and moves its request on to the next step. */
export function notifyAisDone(caseNo: string, status: AisResult["status"]): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  window.parent.postMessage({ negDone: { case_no: caseNo, status } }, "*");
  return true;
}
