"""Direction-aware deal maths. The only module where BUY and SELL behave differently.

direction "buy": we pay; lower is better; the limit is a ceiling.
direction "sell": we receive; higher is better; the limit is a floor.
"""
from __future__ import annotations

from types import MappingProxyType
from typing import Literal, Mapping, Sequence

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
