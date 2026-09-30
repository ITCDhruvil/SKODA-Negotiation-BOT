"""Item state machine and derived event status (spec section 4, A31 to A34)."""
from __future__ import annotations

from typing import Iterable, Literal

EventStatus = Literal["received", "in_progress", "closed"]

TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"points_reviewed"}),
    "points_reviewed": frozenset({"awaiting_bids", "bids_in"}),
    "awaiting_bids": frozenset({"awaiting_bids", "bids_in"}),
    "bids_in": frozenset({"analyzed"}),
    "analyzed": frozenset({"negotiating"}),
    "negotiating": frozenset({"result_pending", "handed_back"}),
    "result_pending": frozenset({"negotiating", "awaiting_approval", "handed_back"}),
    "awaiting_approval": frozenset({"closed", "result_pending"}),
    "handed_back": frozenset({"analyzed", "closed"}),
    "closed": frozenset(),
}


class InvalidTransition(Exception):
    pass


def can_transition(src: str, dst: str) -> bool:
    return dst in TRANSITIONS.get(src, frozenset())


def require_transition(src: str, dst: str) -> None:
    if not can_transition(src, dst):
        raise InvalidTransition(f"item cannot move from {src} to {dst}")


def event_status(states: Iterable[str]) -> EventStatus:
    states = list(states)
    if not states:
        raise ValueError("an event needs at least one item")
    if all(s == "closed" for s in states):
        return "closed"
    if all(s == "draft" for s in states):
        return "received"
    return "in_progress"
