"""The buyer-side brain: what to offer next, when to accept and when to hand back to the buyer.

Every price comparison goes through app.deal, so buy and sell share one code path. The rationale
strings are for the buyer only; they may quote internal targets and limits and are never sent.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app import deal
from app.negotiation.messages import money

MAX_ROUNDS = 8
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


@dataclass(frozen=True)
class Decision:
    kind: str  # "offer" | "accept" | "handback"
    message_kind: str  # wording template: "open" | "counter" | "close" | "accept" | ""
    price: Optional[float]
    payment: Optional[str]
    rationale: str


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
            f"{money(ctx.target)}, so there is nothing better to open with. I recommend accepting.")
    price = deal.round_price(ctx.target)
    ask = _payment_ask(ctx, 2 if ctx.objective == "improve_payment_terms" else 0)
    return Decision(
        "offer", "open", price, ask,
        f"Open at your target of {money(price)}. The vendor quoted {money(ctx.vendor_offer)}, so "
        f"this leaves room to move toward your {deal.limit_word(ctx.direction)} of {money(ctx.limit)}.")


def respond(ctx: Context) -> Decision:
    """Decide the next move after the vendor's latest reply."""
    d, v = ctx.direction, ctx.vendor_offer
    inside = deal.within_limit(d, v, ctx.limit)
    word = deal.limit_word(d)
    if ctx.continuing:
        return _push_further(ctx, word)
    if inside and (ctx.round >= 4 or ctx.vendor_final or deal.gap_to_target(d, v, ctx.target) == 0):
        return Decision(
            "accept", "accept", v, ctx.vendor_payment,
            f"{money(v)} is within your {word} of {money(ctx.limit)}. I recommend accepting.")
    if not inside:
        stalled = ctx.round >= 2 and v == ctx.previous_vendor_offer
        if ctx.vendor_final or ctx.round >= MAX_ROUNDS or stalled or ctx.our_offer == ctx.limit:
            return Decision(
                "handback", "", None, None,
                f"The vendor is at {money(v)}, outside your {word} of {money(ctx.limit)}, and is not "
                "moving further. I recommend handing this back to you to decide.")
        if ctx.round >= 3 and deal.within_pct(v, ctx.limit, CLOSE_WINDOW):
            ask = _payment_ask(ctx, 1)
            more = f" with payment in {deal.payment_days(ask)} days" if ask else ""
            return Decision(
                "offer", "close", ctx.limit, ask,
                f"The vendor is at {money(v)}, only {money(deal.distance(v, ctx.limit))} outside your {word}. "
                f"I recommend asking {money(ctx.limit)}{more} to close.")
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
        + f"I recommend asking {money(nxt)}.")


def _push_further(ctx: Context, word: str) -> Decision:
    """The vendor already agreed; the buyer wants to see if more can be had."""
    d, v = ctx.direction, ctx.vendor_offer
    short = deal.gap_to_target(d, v, ctx.target)
    ask = deal.concede(deal.opposite(d), v, ctx.target, ctx.target, FRACTION) if short > 0 else v
    if short == 0 or not deal.is_better(d, ask, v):
        return Decision(
            "accept", "accept", v, ctx.vendor_payment,
            f"{money(v)} already meets your target of {money(ctx.target)}, or nothing better can "
            "sensibly be asked. I recommend accepting.")
    return Decision(
        "offer", "counter", ask, None,
        f"You asked to keep going. The vendor agreed at {money(v)}, still {money(short)} short of "
        f"your target and within your {word} of {money(ctx.limit)}. I recommend asking {money(ask)}.")
