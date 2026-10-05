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


def message(b: Band) -> str:
    if b == "management":
        return ("This deal is above EUR 50,000, so it is handled by higher management. "
                "The bot does not negotiate it.")
    if b == "supervised":
        return ("This deal is between ten lakh rupees and EUR 50,000, so a person stays in the loop: "
                "messages are drafted for your approval. You may also write them yourself.")
    return "This deal is below ten lakh rupees, so the bot may negotiate it fully on its own."
