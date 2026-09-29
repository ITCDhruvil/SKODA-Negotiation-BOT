"""Direction-aware deal maths. The only module where BUY and SELL behave differently.

direction "buy": we pay; lower is better; the limit is a ceiling.
direction "sell": we receive; higher is better; the limit is a floor.
"""
from __future__ import annotations

from typing import Literal, Sequence

Direction = Literal["buy", "sell"]


def _check(direction: str) -> None:
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")


def value(qty: float, price: float) -> float:
    return round(qty * price, 2)


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
