"""Who handles a deal, by its value (assumption 132).

Below the automatic limit the bot may negotiate fully on its own. Between that and the management limit a person
stays in the loop: by default every message is drafted for approval, and the buyer may still write it by hand.
Above the management limit the bot does not negotiate at all: the deal goes to higher management.
"""
from __future__ import annotations

from typing import Literal

Band = Literal["auto", "supervised", "management"]

EUR_INR = 100.0  # assumed exchange rate, rupees per euro; change here when the real rate is known
AUTO_LIMIT_INR = 1_000_000.0  # below ten lakh rupees the bot may run on its own
PHASE_1_LIMIT_INR = 350_000.0  # up to here the bot needs two offers; above it, three
MANAGEMENT_LIMIT_EUR = 50_000.0  # above this, higher management handles the deal
MANAGEMENT_LIMIT_INR = MANAGEMENT_LIMIT_EUR * EUR_INR


def band(value_inr: float) -> Band:
    """The handling band for a deal worth `value_inr` rupees."""
    if value_inr > MANAGEMENT_LIMIT_INR:
        return "management"
    if value_inr >= AUTO_LIMIT_INR:
        return "supervised"
    return "auto"


def default_mode(b: Band) -> str:
    return "auto" if b == "auto" else "approve"


def allows_auto(b: Band) -> bool:
    return b == "auto"


def headline(b: Band) -> str:
    return {"auto": "Handled by the bot", "supervised": "You check it before it goes", "management": "Handled by higher management"}[b]


def min_offers(value_inr: float) -> int:
    """Offers the bot needs to start (blueprint, Negotiation Bot phases): 2 up to INR 3.5 lakh, 3 above."""
    return 2 if value_inr <= PHASE_1_LIMIT_INR else 3


def message(b: Band) -> str:
    if b == "management":
        return ("This deal is above EUR 50,000 (about INR 50 lakh), so higher management handles it. "
                "The bot does not negotiate it.")
    if b == "supervised":
        return ("This deal is between INR 10 lakh and EUR 50,000. The bot drafts every message, "
                "and you check each one before it is sent.")
    return "This deal is below INR 10 lakh, so the bot negotiates it on its own. You confirm the result."
