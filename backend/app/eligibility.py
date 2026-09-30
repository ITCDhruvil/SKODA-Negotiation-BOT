"""Module 3 eligibility: value band and minimum number of bids (A17, A43)."""
from __future__ import annotations

from dataclasses import dataclass


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


PHASE_1 = Band("phase1", 2_000, 350_000, 2)
PHASE_2 = Band("phase2", 2_000, 1_000_000, 3)
DEFAULT_BAND = PHASE_2


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
        return Eligibility(False, f"value {indian(value)} is above the maximum {indian(band.max_value)}")
    return Eligibility(True)


def check_bids(n_bids: int, band: Band = DEFAULT_BAND) -> Eligibility:
    if n_bids < band.min_bids:
        return Eligibility(False, f"needs at least {band.min_bids} bids (has {n_bids})")
    return Eligibility(True)
