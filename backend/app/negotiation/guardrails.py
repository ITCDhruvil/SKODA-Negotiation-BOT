"""Rules every outgoing offer and message must pass before it reaches the vendor."""
from __future__ import annotations

import re
import unicodedata
from typing import Collection, Optional

from app import deal


class GuardrailError(Exception):
    """An outgoing offer or message broke a rule; the reason is safe to show to the buyer."""


# We speak as a person at the company. Nothing we send may say otherwise. English stems accept the
# usual endings and are matched on word edges with lookarounds, so dotted forms such as "A.I." work.
_ENDINGS = r"(?:s|es|ing|ed)?"


def _stems(stems: list[str]) -> str:
    return r"(?<!\w)(?:" + "|".join(stems) + r")" + _ENDINGS + r"(?!\w)"


_AI_STEMS = [
    r"a\.?i\.?", r"bot", r"chat-?bot", r"assistant", r"automated", r"automation", r"automating",
    r"algorithm", r"llm", r"gpt", r"chat-?gpt", r"openai", r"claude", r"copilot",
    r"language\s+model", r"artificial\s+intelligence", r"machine", r"software", r"robot",
    r"auto-?generated", r"computer[- ]generated", r"virtual\s+agent", r"program", r"script",
    r"not\s+a\s+real\s+person",
]
_AI_WORDS = re.compile(_stems(_AI_STEMS), re.IGNORECASE)

# Devanagari has no word edges worth trusting, so these are plain substring matches.
_AI_DEVANAGARI = re.compile("|".join(unicodedata.normalize("NFKC", t) for t in [
    "बॉट", "एआई", r"ए\.?आई", "कृत्रिम बुद्धिमत्ता", "मशीन", "सॉफ्टवेयर", "स्वचालित", "सॉफ़्टवेयर"]))

# Internal positions never leave the building.
_INTERNAL_STEMS = [
    r"ceiling", r"floor", r"walk[- ]?away", r"limit", r"target", r"reserve", r"budget",
    r"max(?:imum)?\s+price", r"highest\s+we\s+can\s+go", r"lowest\s+we\s+can\s+go",
    r"bottom\s+line", r"rock\s+bottom",
]
_INTERNAL_WORDS = re.compile(_stems(_INTERNAL_STEMS), re.IGNORECASE)
_INTERNAL_DEVANAGARI = re.compile("|".join(unicodedata.normalize("NFKC", t) for t in [
    "सीमा", "लिमिट", "लक्ष्य", "टार्गेट", "टारगेट", "बजट", "अधिकतम", "न्यूनतम", "रिज़र्व", "रिजर्व",
    "मर्यादा", "उद्दिष्ट", "कमाल"]))

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _normalise(text: str) -> str:
    """NFKC with invisible format characters (zero-width joiners and the like) removed."""
    folded = unicodedata.normalize("NFKC", text)
    return "".join(ch for ch in folded if unicodedata.category(ch) != "Cf")


def numbers_in(text: str) -> list[float]:
    out = []
    for token in _NUMBER.findall(_normalise(text)):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:
            continue
    return out


def _plain(x: float) -> str:
    return f"{x:,.2f}".rstrip("0").rstrip(".") if x != int(x) else f"{int(x):,}"


def check_offer(direction: str, price: float, limit: float) -> None:
    if price <= 0:
        raise GuardrailError("The price must be a positive number.")
    if not deal.within_limit(direction, price, limit):
        side = f"beyond your {deal.limit_word(direction)}"
        raise GuardrailError(f"That price is {side}, so it cannot be sent.")


def check_message(
    text: str, *, offer_price: Optional[float], limit: float, target: float,
    allowed_numbers: Optional[Collection[float]] = None, mask: tuple[str, ...] = (),
) -> None:
    """Reject text that reveals our internal numbers, says it was written by software, or names a
    number that is not part of the offer.

    `mask` lists exact strings (the vendor's name, the item description) that are removed before the
    word scans, so a legitimate name such as "Machine Tools Pvt Ltd" cannot make a message
    unsendable. Masked parts are still read for numbers. `allowed_numbers=None` skips the check that
    every number in the text belongs to the offer.
    """
    clean = _normalise(text)
    scanned = clean
    for m in sorted((_normalise(x) for x in mask if x), key=len, reverse=True):
        scanned = scanned.replace(m, " ")
    if _AI_WORDS.search(scanned) or _AI_DEVANAGARI.search(scanned):
        raise GuardrailError("The message mentions automation. Messages must read as written by a person.")
    if _INTERNAL_WORDS.search(scanned) or _INTERNAL_DEVANAGARI.search(scanned):
        raise GuardrailError("The message mentions an internal position such as a limit or target.")
    nums = numbers_in(clean)
    for n in nums:
        if offer_price is not None and deal.same_amount(n, offer_price):
            continue
        for secret in (limit, target):
            if deal.same_amount(n, secret):
                raise GuardrailError("The message contains a number that matches an internal target or limit.")
    if allowed_numbers is not None:
        for n in nums:
            if offer_price is not None and deal.same_amount(n, offer_price):
                continue
            if any(deal.same_amount(n, a) for a in allowed_numbers):
                continue
            offer = _plain(offer_price) if offer_price is not None else "not a price"
            raise GuardrailError(f"The text names {_plain(n)} but the offer is {offer}.")
