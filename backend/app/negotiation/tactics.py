"""The buyer-side brain: what to offer next, when to accept and when to hand back to the buyer.

Every price comparison goes through app.deal, so buy and sell share one code path. The rationale
strings are for the buyer only; they may quote internal targets and limits and are never sent.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app import deal
from app.negotiation.messages import money

MAX_ROUNDS = 12
ACCEPT_AFTER = 8  # an acceptable price that keeps moving is worked on until this round, then taken
MAX_STALLS = 4  # replies in a row without any movement before we stop and hand back
BLUFF_UNTIL = 5  # a "final price" before this round is tested once
NEAR_LIMIT = 0.02  # we only make the closing ask at the limit when our own offer is already this close to it
CLOSE_WINDOW = 0.025  # a vendor within 2.5% of our limit gets a closing offer at the limit
FRACTION = 0.2  # share of the distance to the vendor's price we move each round
FRACTION_PAYMENT_FOCUS = 0.25  # move less on price when the buyer's objective is payment terms


@dataclass(frozen=True)
class Context:
    direction: str
    target: float
    limit: float
    objective: Optional[str]
    round: int  # vendor replies so far
    our_offer: Optional[float]
    vendor_offer: float
    previous_vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    original_price: float
    continuing: bool = False  # the buyer asked to keep going after the vendor had already agreed
    stalls: int = 0  # replies in a row (after the first) without movement from the vendor
    bluff_called: bool = False
    trade_used: bool = False
    leverage_used: bool = False
    split_used: bool = False
    has_alternative: bool = False  # another vendor has really quoted on this item
    alternative: str = ""  # the next-best quote as text, for the hand-back advice


@dataclass(frozen=True)
class Decision:
    kind: str  # "offer" | "accept" | "handback"
    message_kind: str  # wording template: "open" | "counter" | "close" | "accept" | ""
    price: Optional[float]
    payment: Optional[str]
    rationale: str
    tactic: str = ""  # buyer-only label: open, concede, trade, leverage, split, bluff, hold, close, accept, handback


def _payment_ask(ctx: Context, tiers: int) -> Optional[str]:
    code: Optional[str] = ctx.vendor_payment
    asked = None
    for _ in range(tiers):
        code = deal.next_better_payment(ctx.direction, code) if code else None
        if code is None:
            break
        asked = code
    return asked


def opening(ctx: Context) -> Decision:
    if deal.gap_to_target(ctx.direction, ctx.vendor_offer, ctx.target) == 0:
        return Decision(
            "accept", "accept", ctx.vendor_offer, ctx.vendor_payment,
            f"The vendor's quote of {money(ctx.vendor_offer)} already meets your target of "
            f"{money(ctx.target)}, so there is nothing better to open with. I recommend accepting.", "accept")
    price = deal.round_price(ctx.target)
    ask = _payment_ask(ctx, 2 if ctx.objective == "improve_payment_terms" else 0)
    return Decision(
        "offer", "open", price, ask,
        f"Open at your target of {money(price)}. The vendor quoted {money(ctx.vendor_offer)}, so "
        f"this leaves room to move toward your {deal.limit_word(ctx.direction)} of {money(ctx.limit)}.", "open")


def _options(ctx: Context) -> str:
    """What the buyer can do when the conversation cannot reach the limit."""
    word = deal.limit_word(ctx.direction)
    parts = ["accept the best quote as it stands", "trade payment terms instead of price"]
    if ctx.alternative:
        parts.insert(1, f"switch to the next-best quote ({ctx.alternative})")
    parts += [f"adjust your {word} yourself", "close without a deal"]
    return "Options: " + "; ".join(parts) + "."


def respond(ctx: Context) -> Decision:
    """Decide the next move after the vendor's latest reply."""
    d, v = ctx.direction, ctx.vendor_offer
    inside = deal.within_limit(d, v, ctx.limit)
    word = deal.limit_word(d)
    if ctx.continuing:
        return _push_further(ctx, word)
    if inside and (ctx.round >= ACCEPT_AFTER or ctx.vendor_final or ctx.stalls >= 3
                   or deal.gap_to_target(d, v, ctx.target) == 0):
        return Decision(
            "accept", "accept", v, ctx.vendor_payment,
            f"{money(v)} is within your {word} of {money(ctx.limit)}. I recommend accepting.", "accept")
    if not inside:
        stuck_at_limit = ctx.our_offer == ctx.limit and deal.within_pct(v, ctx.previous_vendor_offer, 0.01)
        spent = ctx.round >= MAX_ROUNDS or ctx.stalls >= MAX_STALLS or stuck_at_limit
        if ctx.vendor_final and (ctx.bluff_called or ctx.round >= BLUFF_UNTIL):
            spent = True  # a final price that has been tested, or that came late, is final
        if spent:
            return Decision(
                "handback", "", None, None,
                f"The vendor is at {money(v)}, outside your {word} of {money(ctx.limit)}, and is not moving "
                f"further. I recommend handing this back to you to decide. {_options(ctx)}", "handback")
        if ctx.vendor_final and not ctx.bluff_called and ctx.round < BLUFF_UNTIL:
            # "Final" this early is tested once: a vendor that moves after saying final was never final.
            nxt = deal.concede(d, ctx.our_offer if ctx.our_offer is not None else ctx.target, v, ctx.limit, 0.1)
            return Decision(
                "offer", "bluff", nxt, None,
                f"The vendor called {money(v)} final in round {ctx.round}, which is early. I recommend testing it "
                f"once with {money(nxt)} before accepting that it is final.", "bluff")
        near = ctx.our_offer is not None and deal.within_pct(ctx.our_offer, ctx.limit, NEAR_LIMIT)
        if ctx.round >= 3 and ctx.stalls == 0 and near and deal.within_pct(v, ctx.limit, CLOSE_WINDOW):
            ask = _payment_ask(ctx, 1)
            more = f" with payment in {deal.payment_days(ask)} days" if ask else ""
            return Decision(
                "offer", "close", ctx.limit, ask,
                f"The vendor is at {money(v)}, only {money(deal.distance(v, ctx.limit))} outside your {word}. "
                f"I recommend asking {money(ctx.limit)}{more} to close.", "close")
    if ctx.stalls >= 1:  # the vendor did not move: try terms, other offers, then the middle, before anything else
        held = ctx.our_offer if ctx.our_offer is not None else ctx.target
        if not ctx.trade_used:
            ask = _payment_ask(ctx, 1)
            if ask:
                return Decision(
                    "offer", "trade", held, ask,
                    f"The vendor did not move from {money(v)}. I recommend holding at {money(held)} and asking for "
                    f"payment in {deal.payment_days(ask)} days instead: a terms trade costs the vendor less than price.", "trade")
        if ctx.has_alternative and not ctx.leverage_used:
            nxt = deal.concede(d, held, v, ctx.limit, 0.15)
            return Decision(
                "offer", "leverage", nxt, None,
                f"Still no movement from {money(v)}. Another vendor has really quoted on this item, so I recommend "
                f"saying other offers are closer to what you expected (no number named) and asking {money(nxt)}.", "leverage")
        if ctx.stalls >= 2 and not ctx.split_used:
            mid = deal.concede(d, held, v, ctx.limit, 0.5)
            if deal.is_better(d, mid, v):
                return Decision(
                    "offer", "split", mid, None,
                    f"The vendor has stalled twice at {money(v)}. I recommend offering to meet in the middle at "
                    f"{money(mid)}, which is still inside your {word} of {money(ctx.limit)}.", "split")
        if ctx.our_offer == ctx.limit and not inside:
            return Decision(
                "offer", "close", ctx.limit, None,
                f"You are already at your {word} of {money(ctx.limit)} and the vendor has not moved. I recommend "
                "restating it firmly once more.", "hold")
    fraction = FRACTION_PAYMENT_FOCUS if ctx.objective == "improve_payment_terms" else FRACTION
    nxt = deal.concede(d, ctx.our_offer if ctx.our_offer is not None else ctx.target, v, ctx.limit, fraction)
    ask = _payment_ask(ctx, 1) if ctx.objective == "improve_payment_terms" else None
    moved = deal.distance(v, ctx.previous_vendor_offer)
    return Decision(
        "offer", "counter", nxt, ask,
        f"The vendor moved {money(moved)} to {money(v)}. "
        + (f"That is still {money(deal.distance(v, ctx.limit))} outside your {word}. " if not inside
           else f"That is already within your {word}, but {money(deal.gap_to_target(d, v, ctx.target))} "
                "short of your target. ")
        + f"I recommend asking {money(nxt)}.", "concede")


def _push_further(ctx: Context, word: str) -> Decision:
    """The vendor already agreed; the buyer wants to see if more can be had."""
    d, v = ctx.direction, ctx.vendor_offer
    short = deal.gap_to_target(d, v, ctx.target)
    ask = deal.concede(deal.opposite(d), v, ctx.target, ctx.target, FRACTION) if short > 0 else v
    if short == 0 or not deal.is_better(d, ask, v):
        return Decision(
            "accept", "accept", v, ctx.vendor_payment,
            f"{money(v)} already meets your target of {money(ctx.target)}, or nothing better can "
            "sensibly be asked. I recommend accepting.", "accept")
    return Decision(
        "offer", "counter", ask, None,
        f"You asked to keep going. The vendor agreed at {money(v)}, still {money(short)} short of "
        f"your target and within your {word} of {money(ctx.limit)}. I recommend asking {money(ask)}.", "concede")
