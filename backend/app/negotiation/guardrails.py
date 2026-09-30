"""Rules every outgoing offer and message must pass before it reaches the vendor."""
from __future__ import annotations

import re
from typing import Optional

from app import deal


class GuardrailError(Exception):
    """An outgoing offer or message broke a rule; the reason is safe to show to the buyer."""


# We speak as a person at the company. Nothing we send may say otherwise.
_AI_WORDS = re.compile(
    r"\b(ai|a\.i\.|bot|chatbot|assistant|automated|automation|algorithm|llm|gpt|"
    r"language model|artificial intelligence|machine)\b", re.IGNORECASE)

# Internal positions never leave the building.
_INTERNAL_WORDS = re.compile(
    r"\b(ceiling|floor|walk[- ]?away|limit|target|reserve|budget|max(imum)? price)\b", re.IGNORECASE)

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[float]:
    out = []
    for token in _NUMBER.findall(text):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:
            continue
    return out


def check_offer(direction: str, price: float, limit: float) -> None:
    if price <= 0:
        raise GuardrailError("The price must be a positive number.")
    if not deal.within_limit(direction, price, limit):
        side = "above your ceiling" if direction == "buy" else "below your floor"
        raise GuardrailError(f"That price is {side}, so it cannot be sent.")


def check_message(
    text: str, *, offer_price: Optional[float], limit: float, target: float,
) -> None:
    """Reject text that reveals our internal numbers or says it was written by software."""
    if _AI_WORDS.search(text):
        raise GuardrailError("The message mentions automation. Messages must read as written by a person.")
    if _INTERNAL_WORDS.search(text):
        raise GuardrailError("The message mentions an internal position such as a limit or target.")
    for n in _numbers(text):
        if offer_price is not None and abs(n - offer_price) < 0.005:
            continue
        for secret in (limit, target):
            if abs(n - secret) < 0.005:
                raise GuardrailError("The message contains a number that matches an internal target or limit.")
