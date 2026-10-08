"""Module 3 eligibility: value band and minimum number of bids (A17, A43)."""
from __future__ import annotations

from dataclasses import dataclass

from app import policy


@dataclass(frozen=True)
class Band:
    name: str
    min_value: float
    max_value: float
    min_bids: int


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    reason: str = ""


# Deals the bot negotiates on its own (below ten lakh); the sample data was generated with this band.
AUTO_BAND = Band("auto", 2_000, policy.AUTO_LIMIT_INR, policy.MIN_OFFERS)
# Live band: anything up to EUR 50,000 can be negotiated (a person joins above ten lakh); above that, higher management handles it.
LIVE_BAND = Band("live", 2_000, policy.MANAGEMENT_LIMIT_INR, policy.MIN_OFFERS)
DEFAULT_BAND = LIVE_BAND


def indian(value: float) -> str:
    """Whole number with Indian digit grouping: 1234567 -> 12,34,567."""
    n = int(round(value))
    sign, digits = ("-" if n < 0 else ""), str(abs(n))
    if len(digits) <= 3:
        return sign + digits
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return sign + ",".join(groups + [tail])


def check_value(value: float, band: Band = DEFAULT_BAND) -> Eligibility:
    if value < band.min_value:
        return Eligibility(False, f"value {indian(value)} is below the minimum {indian(band.min_value)}")
    if value > band.max_value:
        if band is LIVE_BAND:
            return Eligibility(False, f"value {indian(value)} is above EUR 50,000, so higher management handles it")
        return Eligibility(False, f"value {indian(value)} is above the maximum {indian(band.max_value)}")
    return Eligibility(True)


def check_bids(n_bids: int, band: Band = DEFAULT_BAND) -> Eligibility:
    if n_bids < band.min_bids:
        return Eligibility(False, f"needs at least {band.min_bids} bids (has {n_bids})")
    return Eligibility(True)
