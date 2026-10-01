"""Direction-aware deal maths. The only module where BUY and SELL behave differently.

direction "buy": we pay; lower is better; the limit is a ceiling.
direction "sell": we receive; higher is better; the limit is a floor.
"""
from __future__ import annotations

import math
from types import MappingProxyType
from typing import Iterable, Literal, Mapping, Optional, Sequence

Direction = Literal["buy", "sell"]


def _check(direction: str) -> None:
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")


def value(qty: float, price: float) -> float:
    return round(qty * price, 2)


def reference_value(pairs: Iterable[tuple[float, float]]) -> float:
    """Total reference value of (qty, price) pairs, rounded to 2 decimals."""
    return round(sum(value(q, p) for q, p in pairs), 2)


def best_price(direction: Direction, prices: Sequence[float]) -> float:
    _check(direction)
    if not prices:
        raise ValueError("no prices")
    return min(prices) if direction == "buy" else max(prices)


def within_limit(direction: Direction, price: float, limit: float) -> bool:
    _check(direction)
    return price <= limit if direction == "buy" else price >= limit


def gap_to_target(direction: Direction, price: float, target: float) -> float:
    """Distance still to travel to reach the target; 0 once the target is met or beaten."""
    _check(direction)
    raw = price - target if direction == "buy" else target - price
    return round(max(0.0, raw), 2)


def potential_delta(direction: Direction, price: float, target: float, qty: float) -> float:
    return round(gap_to_target(direction, price, target) * qty, 2)


def realised_delta(direction: Direction, original: float, final: float, qty: float) -> float:
    """Savings (buy) or uplift (sell); positive means better for us."""
    _check(direction)
    per_unit = original - final if direction == "buy" else final - original
    return round(per_unit * qty, 2)


def anchors_valid(direction: Direction, target: float, limit: float, best_bid: float) -> bool:
    """Normal negotiation start: the best bid is outside our limit (A7, A8)."""
    _check(direction)
    if direction == "buy":
        return target <= limit < best_bid
    return best_bid < limit <= target


from dataclasses import dataclass, field  # noqa: E402


@dataclass(frozen=True)
class TermsConfig:
    """Illustrative rates (A15). One place to tune."""

    carry_rate: float = 0.12
    warranty_rate_per_month: float = 0.002
    delay_rate_per_day: float = 0.0005
    freight_pct_buy: Mapping[str, float] = field(
        default_factory=lambda: MappingProxyType(
            {"EXW": 0.03, "FCA": 0.02, "FH": 0.0, "DAP": 0.0, "DDP": 0.0})
    )
    freight_pct_sell: Mapping[str, float] = field(
        default_factory=lambda: MappingProxyType(
            {"EXW": 0.0, "FCA": 0.005, "FH": 0.02, "DAP": 0.02, "DDP": 0.03})
    )


DEFAULT_TERMS = TermsConfig()


def payment_days(code: str) -> int:
    c = code.strip().upper()
    if c.startswith("ZD") and c[2:].isdigit():
        return int(c[2:])
    if c in ("ADV", "LC"):
        return 0
    raise ValueError(f"unknown payment code {code!r}")


def effective_price(
    direction: Direction,
    price: float,
    *,
    payment_code: str,
    incoterm: str,
    delivery_days: int,
    warranty_months: int = 0,
    cfg: TermsConfig = DEFAULT_TERMS,
) -> float:
    """Price adjusted for the terms attached to it, so offers with different terms compare.

    Later payment lowers the present value for both directions. The remaining adjustment is a cost
    for us on BUY (freight, delay, less warranty benefit) and a revenue reduction on SELL.
    """
    _check(direction)
    present_value = price * (1 - cfg.carry_rate * payment_days(payment_code) / 365)
    table = cfg.freight_pct_buy if direction == "buy" else cfg.freight_pct_sell
    key = incoterm.strip().upper()
    if key not in table:
        raise ValueError(f"unknown incoterm {incoterm!r}")
    adjustment = price * (
        table[key]
        + cfg.delay_rate_per_day * delivery_days
        - cfg.warranty_rate_per_month * warranty_months
    )
    total = present_value + adjustment if direction == "buy" else present_value - adjustment
    return round(total, 2)


def points_valid(direction: Direction, target: float, limit: float) -> bool:
    """Buyer's negotiation points: BUY target <= ceiling, SELL floor <= target; both positive."""
    _check(direction)
    if target <= 0 or limit <= 0:
        return False
    return target <= limit if direction == "buy" else limit <= target


def points_hint(direction: Direction) -> str:
    """Plain-language rule behind points_valid, for error messages."""
    _check(direction)
    return ("target must not exceed the ceiling" if direction == "buy"
            else "the floor must not exceed the target")


def bid_spread(prices: Sequence[float]) -> float:
    """Relative gap between the highest and lowest bid: (max - min) / min."""
    if len(prices) < 2:
        return 0.0
    lo, hi = min(prices), max(prices)
    if lo <= 0:
        raise ValueError("prices must be positive")
    return round((hi - lo) / lo, 4)


def best_first(direction: Direction, values: Sequence, key=lambda v: v) -> list:
    """Sort so the best price for us comes first (lowest for buy, highest for sell)."""
    _check(direction)
    return sorted(values, key=key, reverse=direction == "sell")


# --- negotiation helpers -------------------------------------------------------------------

def opposite(direction: Direction) -> Direction:
    """The counterparty's direction: a buyer's vendor sells, a seller's vendor buys."""
    _check(direction)
    return "sell" if direction == "buy" else "buy"


def round_price(x: float) -> float:
    """Whole rupees from 100 up, paise below; halves round up."""
    if x >= 100:
        return float(math.floor(x + 0.5))
    return math.floor(x * 100 + 0.5) / 100


def concede(mover: Direction, current: float, other: float, bound: float, fraction: float) -> float:
    """Move `current` toward `other` by `fraction`, never past `bound` (the mover's walk-away).

    `mover` is the direction of whoever is moving: a buyer moves up toward the seller's price but
    never above their ceiling; a seller moves down but never below their floor.
    """
    _check(mover)
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must be between 0 and 1")
    moved = round_price(current + fraction * (other - current))
    return moved if within_limit(mover, moved, bound) else bound


_LADDER = ("ADV", "ZD15", "ZD30", "ZD45", "ZD60")


def better_payment(direction: Direction, a: str, b: str) -> bool:
    """True when payment code `a` is strictly better for us than `b`.

    A buyer prefers to pay later; a seller prefers to be paid sooner.
    """
    _check(direction)
    da, db = payment_days(a), payment_days(b)
    return da > db if direction == "buy" else da < db


def next_better_payment(direction: Direction, code: str) -> Optional[str]:
    """The next payment tier that is better for us than `code`, or None if already the best."""
    _check(direction)
    days = payment_days(code)
    steps = [(payment_days(c), c) for c in _LADDER]
    if direction == "buy":
        better = [c for d, c in steps if d > days]
        return better[0] if better else None
    better = [c for d, c in steps if d < days]
    return better[-1] if better else None


def is_better(direction: Direction, a: float, b: float) -> bool:
    """True when price `a` is strictly better for us than `b` (lower on BUY, higher on SELL)."""
    _check(direction)
    return a < b if direction == "buy" else a > b


def limit_word(direction: Direction) -> str:
    """What the limit is called in plain language: a ceiling when we buy, a floor when we sell."""
    _check(direction)
    return "ceiling" if direction == "buy" else "floor"


def distance(a: float, b: float) -> float:
    """Absolute gap between two prices."""
    return abs(a - b)


def relative_gap(a: float, b: float) -> float:
    """Gap between `a` and the reference price `b`, as a fraction of `b`."""
    return abs(a - b) / b


def within_pct(a: float, b: float, pct: float) -> bool:
    """True when `a` is within the fraction `pct` of the reference price `b`."""
    return relative_gap(a, b) <= pct


def same_amount(a: float, b: float, tolerance: float = 0.005) -> bool:
    """True when two amounts are equal to within half a paisa."""
    return abs(a - b) < tolerance


# --- how hard a vendor has been to move, from past negotiated deals -------------------------------

TOUGH_MIN_DEALS = 3  # fewer negotiated deals than this and we do not judge
HARD_BELOW = 0.025  # on average the price moved less than this share of the original quote
FIRM_BELOW = 0.045


def concession_share(direction: Direction, original: float, final: float) -> float:
    """The share of the original price that negotiation moved in our favour (negative when it moved against us)."""
    _check(direction)
    if original <= 0:
        raise ValueError("the original price must be positive")
    per_unit = original - final if direction == "buy" else final - original
    return per_unit / original


def toughness_level(average_share: Optional[float], deals: int) -> str:
    """"unknown", "hard", "firm" or "flexible" from the average share the price moved in past negotiations."""
    if average_share is None or deals < TOUGH_MIN_DEALS:
        return "unknown"
    if average_share < HARD_BELOW:
        return "hard"
    if average_share < FIRM_BELOW:
        return "firm"
    return "flexible"

