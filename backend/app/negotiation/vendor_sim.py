"""A rule-based stand-in for the vendor. It knows a hidden reserve price and how flexible it is.

The vendor moves part of the way toward our offer each round and never past its reserve. If our
offer already meets its reserve it accepts. Nothing here calls a model, so runs are repeatable.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Optional

from app import deal

# Demo vendors with a known story (spec section 5): the best bidder on each hero item.
HERO_FLEX = {"EVT-2026-041-01-B1": 0.3, "EVT-2026-052-01-B1": 0.4}
_FLEX = (0.3, 0.4, 0.5)
MAX_VENDOR_ROUNDS = 7
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
) -> VendorReply:
    """The vendor's answer to our offer. `round_no` counts replies already given (0 for the first)."""
    mover = deal.opposite(event_direction)  # the vendor's own direction
    if deal.within_limit(mover, offer_price, reserve) and round_no < MIN_ROUNDS_TO_ACCEPT:
        # It could say yes, but a real vendor tries for a little more first: it edges toward our offer
        # without reaching it, so there is another round of talking before the deal.
        step = deal.concede(mover, vendor_price, offer_price, offer_price, flex * STEP)
        if step != offer_price:
            return VendorReply("counter", step, vendor_payment, False)
    if deal.within_limit(mover, offer_price, reserve):
        payment = vendor_payment
        if (offer_payment and deal.better_payment(event_direction, offer_payment, vendor_payment)
                and abs(deal.payment_days(offer_payment) - deal.payment_days(vendor_payment))
                <= GRANT_PAYMENT_DAYS):
            payment = offer_payment
        return VendorReply("accept", offer_price, payment, True)
    if round_no == 0 and abs(offer_price - vendor_price) / vendor_price > HOLD_GAP:
        return VendorReply("hold", vendor_price, vendor_payment, False)  # explains its price, gives nothing yet
    moved = deal.concede(mover, vendor_price, offer_price, reserve, flex * STEP)
    if deal.within_pct(moved, reserve, SNAP):
        moved = reserve
        final = True
    else:
        final = moved == vendor_price or round_no + 1 >= MAX_VENDOR_ROUNDS
    return VendorReply("firm" if final else "counter", moved, vendor_payment, final)
