"""A rule-based stand-in for the vendor. It knows a hidden reserve price and how flexible it is.

The vendor moves part of the way toward our offer each round and never past its reserve. If our
offer already meets its reserve it accepts. Nothing here calls a model, so runs are repeatable.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Optional

from app import deal, ids
from app.negotiation.personas import HARD_PERSONAS, PROFILES

# Demo vendors with a known story (spec section 5): the best bidder on each hero item.
HERO_FLEX = {"AIS-E1-2026-00077-01-B1": 0.3, "AIS-E1-2026-00088-01-B1": 0.4}
_FLEX = (0.3, 0.4, 0.5)
MAX_VENDOR_ROUNDS = 12
STEP = 0.6  # the vendor gives up this share of its flexibility per round, so it takes several rounds
MIN_ROUNDS_TO_ACCEPT = 3  # replies it gives before it will say yes to an offer it could accept
HOLD_GAP = 0.03  # a first offer this far from its price (as a share of it) is met with a pushback, not a move
GRANT_PAYMENT_DAYS = 15  # the vendor will improve payment terms by up to this many days
# Irritation at which a hard vendor names a final price, and at which it leaves after one. A refuser has less patience.
PATIENCE = {"refuser": (10, 18)}
PATIENCE_DEFAULT = (32, 50)
SNAP = 0.003  # within 0.3% of its reserve the vendor stops haggling and calls it final
CRAWL = 1.0  # a crawler moves this many rupees a round (a quarter of a rupee below Rs 100)


def flexibility(bid_id: str) -> float:
    """How far the vendor moves toward our offer each round (0..1), fixed per bid."""
    if bid_id in HERO_FLEX:
        return HERO_FLEX[bid_id]
    return _FLEX[zlib.crc32(ids.legacy_key(bid_id).encode("utf-8")) % len(_FLEX)]


@dataclass(frozen=True)
class VendorReply:
    kind: str  # "accept" | "hold" | "counter" | "firm"
    price: float
    payment: str
    final: bool
    flavour: str = ""  # how it pushes back: frustrated, nothing_left, ultimatum, rescope, walkaway, deadline, nibble
    ends: bool = False  # the vendor leaves the conversation
    mood: int = 0  # its irritation after this reply


def _base(
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
    tactic: str = "",
) -> VendorReply:
    """The vendor's price move for our offer. `round_no` counts replies already given (0 for the first)."""
    mover = deal.opposite(event_direction)  # the vendor's own direction
    prof = PROFILES[persona]
    accepts = deal.within_limit(mover, offer_price, reserve)
    improves = bool(offer_payment) and deal.better_payment(event_direction, offer_payment, vendor_payment)
    crawling = persona == "crawler" and not improves and tactic not in ("trade", "split")
    if persona != "cooperative" and round_no == prof.bluff_at and not accepts:
        # "That is my final price": said without moving, and not meant.
        return VendorReply("firm", vendor_price, vendor_payment, True)
    if accepts and round_no < max(MIN_ROUNDS_TO_ACCEPT, prof.accept_after if persona != "cooperative" else 0):
        # It could say yes, but a real vendor tries for a little more first: it edges toward our offer
        # without reaching it, so there is another round of talking before the deal.
        step = (_crawl(mover, vendor_price, offer_price, offer_price) if crawling
                else deal.concede(mover, vendor_price, offer_price, offer_price, flex * STEP * max(prof.step(round_no), 0.3)))
        if step != offer_price:
            # No visible step at its price is a hold, not a move.
            return VendorReply("counter" if step != vendor_price else "hold", step, vendor_payment, False)
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
    moved = (_crawl(mover, vendor_price, offer_price, reserve) if crawling
             else deal.concede(mover, vendor_price, offer_price, reserve, flex * STEP * mult))
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


def _crawl(mover: str, vendor_price: float, offer_price: float, bound: float) -> float:
    """A token step toward our offer: a rupee or so, never past the bound."""
    gap = abs(offer_price - vendor_price)
    if gap == 0:
        return vendor_price
    step = CRAWL if vendor_price >= 100 else CRAWL / 4
    return deal.concede(mover, vendor_price, offer_price, bound, min(1.0, step / gap))


def _roll(seed: str, round_no: int) -> int:
    return zlib.crc32(f"roll:{ids.legacy_key(seed)}:{round_no}".encode("utf-8")) % 100


def next_mood(mood: int, *, accepts: bool, offer_price: float, reserve: float, our_prev: Optional[float]) -> int:
    """Irritation rises with how far below its floor we offer and with stingy steps, and eases when we are within reach."""
    if accepts:
        return max(0, mood - 15)
    below = abs(offer_price - reserve) / reserve
    add = 4 + min(18, int(below * 220))
    if our_prev and abs(offer_price - our_prev) / our_prev < 0.01:
        add += 6  # a tiny step after a tiny step
    return min(100, mood + add)


def mood_label(mood: int) -> str:
    return "calm" if mood < 25 else "impatient" if mood < 50 else "frustrated" if mood < 75 else "walking_away"


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
    tactic: str = "",
    mood: int = 0,
    our_prev: Optional[float] = None,
    ultimatum_round: int = -1,
    scripted: bool = False,
    seed: str = "",
) -> VendorReply:
    """The vendor's answer: its price move, and how it feels about our offer.

    A vendor that is being pushed hard shows it: it says the offer is too far away, claims nothing is left to give,
    names a final price, offers a smaller lot instead, sets a deadline or, once irritated enough, leaves. Only the
    harder personas refuse or leave; every vendor can be mildly put out. Fixed demo stories (`scripted`) never do.
    """
    base = _base(event_direction, reserve=reserve, flex=flex, vendor_price=vendor_price, vendor_payment=vendor_payment,
                 offer_price=offer_price, offer_payment=offer_payment, round_no=round_no, persona=persona, tactic=tactic)
    mover = deal.opposite(event_direction)
    accepts = deal.within_limit(mover, offer_price, reserve)
    mood = next_mood(mood, accepts=accepts, offer_price=offer_price, reserve=reserve, our_prev=our_prev)
    if scripted:
        return VendorReply(base.kind, base.price, base.payment, base.final, mood=mood)
    hard = persona in HARD_PERSONAS
    ult_mood, walk_mood = PATIENCE.get(persona, PATIENCE_DEFAULT)
    below = 0.0 if accepts else abs(offer_price - reserve) / reserve
    near_floor = deal.within_pct(base.price, reserve, 0.04)
    roll = _roll(seed, round_no)
    kind, price, payment, final, flavour, ends = base.kind, base.price, base.payment, base.final, "", False
    if base.kind == "accept":
        if round_no >= 3 and roll < 20:
            flavour = "nibble"
    elif (hard and persona != "crawler" and our_prev is not None and round_no >= 3 and not accepts
          and abs(offer_price - our_prev) / our_prev <= 0.003):
        # The buyer has stopped moving and is still below its floor: a hard vendor ends it rather than go round again.
        flavour, ends, kind, price, payment, final = "walkaway", True, "firm", vendor_price, vendor_payment, True
    elif hard and ultimatum_round >= 0 and round_no >= ultimatum_round + (1 if persona == "refuser" else 2) and mood >= walk_mood and not accepts:
        flavour, ends, kind, price, payment, final = "walkaway", True, "firm", vendor_price, vendor_payment, True
    elif hard and ultimatum_round < 0 and round_no >= (2 if persona == "refuser" else 3) and mood >= ult_mood and (near_floor or persona == "refuser") and not accepts:
        flavour, kind, final = "ultimatum", "firm", True
    elif hard and base.kind in ("hold", "firm") and round_no >= 2 and mood >= 25 and roll < 60 and not accepts:
        flavour = "nothing_left"
    elif below > 0.10 and round_no >= 1 and mood >= 20 and roll < 70:
        flavour, kind, price, payment, final = "rescope", "hold", vendor_price, vendor_payment, False
    elif mood >= 28 and base.kind in ("hold", "counter") and roll < 55:
        flavour = "frustrated"
    elif (persona == "deadline" or base.final) and round_no >= 2 and roll < 45:
        flavour = "deadline"
    return VendorReply(kind, price, payment, final, flavour=flavour, ends=ends, mood=mood)
