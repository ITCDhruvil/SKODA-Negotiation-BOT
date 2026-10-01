"""A rule-based stand-in for the vendor. It knows a hidden reserve price and how flexible it is.

The vendor moves part of the way toward our offer each round and never past its reserve. If our
offer already meets its reserve it accepts. Nothing here calls a model, so runs are repeatable.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Optional

from app import deal
from app.negotiation.personas import PROFILES

# Demo vendors with a known story (spec section 5): the best bidder on each hero item.
HERO_FLEX = {"EVT-2026-041-01-B1": 0.3, "EVT-2026-052-01-B1": 0.4}
_FLEX = (0.3, 0.4, 0.5)
MAX_VENDOR_ROUNDS = 12
STEP = 0.6  # the vendor gives up this share of its flexibility per round, so it takes several rounds
MIN_ROUNDS_TO_ACCEPT = 3  # replies it gives before it will say yes to an offer it could accept
HOLD_GAP = 0.03  # a first offer this far from its price (as a share of it) is met with a pushback, not a move
GRANT_PAYMENT_DAYS = 15  # the vendor will improve payment terms by up to this many days
SNAP = 0.003  # within 0.3% of its reserve the vendor stops haggling and calls it final


def flexibility(bid_id: str) -> float:
    """How far the vendor moves toward our offer each round (0..1), fixed per bid."""
    if bid_id in HERO_FLEX:
        return HERO_FLEX[bid_id]
    return _FLEX[zlib.crc32(bid_id.encode("utf-8")) % len(_FLEX)]


@dataclass(frozen=True)
class VendorReply:
    kind: str  # "accept" | "hold" | "counter" | "firm"
    price: float
    payment: str
    final: bool


def reply(
    event_direction: str,
    *,
    reserve: float,
    flex: float,
    vendor_price: float,
    vendor_payment: str,
    offer_price: float,
    offer_payment: Optional[str],
    round_no: int,
    persona: str = "cooperative",
) -> VendorReply:
    """The vendor's answer to our offer. `round_no` counts replies already given (0 for the first)."""
    mover = deal.opposite(event_direction)  # the vendor's own direction
    prof = PROFILES[persona]
    accepts = deal.within_limit(mover, offer_price, reserve)
    if persona != "cooperative" and round_no == prof.bluff_at and not accepts:
        # "That is my final price": said without moving, and not meant.
        return VendorReply("firm", vendor_price, vendor_payment, True)
    if accepts and round_no < max(MIN_ROUNDS_TO_ACCEPT, prof.accept_after if persona != "cooperative" else 0):
        # It could say yes, but a real vendor tries for a little more first: it edges toward our offer
        # without reaching it, so there is another round of talking before the deal.
        step = deal.concede(mover, vendor_price, offer_price, offer_price, flex * STEP * max(prof.step(round_no), 0.3))
        if step != offer_price:
            return VendorReply("counter", step, vendor_payment, False)
    if accepts:
        payment = vendor_payment
        if (offer_payment and deal.better_payment(event_direction, offer_payment, vendor_payment)
                and abs(deal.payment_days(offer_payment) - deal.payment_days(vendor_payment)) <= prof.grant_days):
            payment = offer_payment
        return VendorReply("accept", offer_price, payment, True)
    if round_no == 0 and abs(offer_price - vendor_price) / vendor_price > HOLD_GAP:
        return VendorReply("hold", vendor_price, vendor_payment, False)  # explains its price, gives nothing yet
    mult = prof.step(round_no)
    # A better payment term on offer buys a little more price from a vendor that likes terms.
    payment = vendor_payment
    if (offer_payment and deal.better_payment(event_direction, offer_payment, vendor_payment)
            and abs(deal.payment_days(offer_payment) - deal.payment_days(vendor_payment)) <= prof.grant_days):
        payment = offer_payment
        mult = max(mult, 0.8) if persona == "terms" else mult
    if mult <= 0:
        return VendorReply("hold", vendor_price, payment, round_no + 1 >= MAX_VENDOR_ROUNDS)
    moved = deal.concede(mover, vendor_price, offer_price, reserve, flex * STEP * mult)
    if deal.within_pct(moved, reserve, SNAP):
        moved = reserve
        final = True
    elif moved == vendor_price:
        # No visible step this round: the vendor is only final once it is already at its floor.
        final = deal.within_pct(vendor_price, reserve, SNAP) or round_no + 1 >= MAX_VENDOR_ROUNDS
    else:
        final = round_no + 1 >= MAX_VENDOR_ROUNDS
    kind = "firm" if final else ("hold" if moved == vendor_price and payment == vendor_payment else "counter")
    return VendorReply(kind, moved, payment, final)
