"""Hidden vendor personas for the simulated counterparty.

A persona is how a vendor behaves, not what it can afford: the reserve price still decides where it stops.
A persona is a per-round step profile (how much of its normal flexibility it uses), a payment-grant allowance
and a few quirks. It is chosen deterministically from the bid, so runs are repeatable, and it is never shown
to the buyer. Vendors flagged as hard to move (and which the buyer's history also shows as hard) draw from
the stubborn personas; the demo-story bids always stay cooperative.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Callable

from app.seed.constants import HARD_VENDORS

COOPERATIVE_BIDS = {"EVT-2026-041-01-B1", "EVT-2026-052-01-B1"}  # the first two demo stories
DEMO_PERSONAS = {"EVT-2026-041-01-B2": "bluffer"}  # the hard-vendor demo story


@dataclass(frozen=True)
class Profile:
    step: Callable[[int], float]  # multiplier on the vendor's flexibility, by replies already given
    grant_days: int = 15  # extra payment days it will concede
    accept_after: int = 3  # replies it gives before it will say yes to an acceptable offer
    bluff_at: int = -1  # reply index at which it calls its price final without moving (-1: never)


PROFILES: dict[str, Profile] = {
    "cooperative": Profile(step=lambda r: 1.0),
    # holds almost completely for the first replies, then moves in small steps
    "anchor": Profile(step=lambda r: 0.0 if r < 2 else (0.5 if r < 4 else 1.0), accept_after=5),
    # says "final price" early, then moves once pushed
    "bluffer": Profile(step=lambda r: 1.3, accept_after=4, bluff_at=1),
    # price barely moves, but it is generous on payment terms
    "terms": Profile(step=lambda r: 0.35, grant_days=30, accept_after=4),
    # softens as the deal gets closer to a deadline
    "deadline": Profile(step=lambda r: min(1.8, 0.4 + 0.25 * r)),
    # warms up once the relationship has been built
    "relationship": Profile(step=lambda r: 0.6 if r < 3 else 1.5),
}

_EASY = ("cooperative",) * 7 + ("deadline", "relationship", "terms")
_HARD = ("anchor", "bluffer", "terms", "anchor")


def persona_for(bid_id: str, vendor_id: str) -> str:
    if bid_id in COOPERATIVE_BIDS:
        return "cooperative"
    if bid_id in DEMO_PERSONAS:
        return DEMO_PERSONAS[bid_id]
    pick = zlib.crc32(f"persona:{bid_id}".encode("utf-8"))
    pool = _HARD if vendor_id in HARD_VENDORS else _EASY
    return pool[pick % len(pool)]
