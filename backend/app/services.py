"""Buyer commands. Each validates rules, then persists. No negotiation logic (Phase 4)."""
from __future__ import annotations

from typing import Optional

from app import deal, eligibility, lifecycle
from app.models import Item, Objective
from app.store import Repo


class NotFound(LookupError):
    pass


class Conflict(Exception):
    pass


def _item(repo: Repo, item_id: str) -> Item:
    item = repo.get("item", item_id)
    if item is None:
        raise NotFound(f"item {item_id} not found")
    return item


def _save(repo: Repo, item: Item) -> Item:
    repo.put("item", item.id, item, parent=item.event_id)
    return item


def _direction(repo: Repo, item: Item) -> str:
    return repo.get("event", item.event_id).direction


def _reference_value(repo: Repo, event_id: str) -> float:
    return sum(i.qty * i.reference_price for i in repo.fetch("item", parent=event_id))


def set_points(repo: Repo, item_id: str, *, target: float, limit: float,
               objective: Optional[Objective] = None) -> Item:
    item = _item(repo, item_id)
    if item.state not in ("draft", "points_reviewed"):
        raise Conflict(f"points can no longer be changed in state {item.state}")
    direction = _direction(repo, item)
    if not deal.points_valid(direction, target, limit):
        raise Conflict(
            f"target {target} and limit {limit} are inconsistent for a {direction} event "
            f"({'target must not exceed the ceiling' if direction == 'buy' else 'the floor must not exceed the target'})")
    return _save(repo, item.model_copy(update={"target": target, "limit": limit,
                                                "objective": objective}))


def confirm_points(repo: Repo, item_id: str) -> Item:
    item = _item(repo, item_id)
    if item.target is None or item.limit is None:
        raise Conflict("set target and limit before confirming")
    check = eligibility.check_value(_reference_value(repo, item.event_id))
    if not check.eligible:
        raise Conflict(f"not eligible for negotiation: {check.reason}")
    lifecycle.require_transition(item.state, "points_reviewed")
    return _save(repo, item.model_copy(update={"state": "points_reviewed"}))


def release_bids(repo: Repo, item_id: str, vendor_ids: Optional[list[str]] = None) -> Item:
    item = _item(repo, item_id)
    if item.state not in ("points_reviewed", "awaiting_bids"):
        raise Conflict(f"bids cannot be released in state {item.state}")
    pending = repo.fetch("scripted_bid", parent=item_id)
    if vendor_ids is not None:
        unknown = set(vendor_ids) - {b.vendor_id for b in pending}
        if unknown:
            raise Conflict(f"no pending response from: {', '.join(sorted(unknown))}")
    chosen = [b for b in pending if vendor_ids is None or b.vendor_id in vendor_ids]
    if not chosen:
        raise Conflict("no pending vendor responses to release")
    with repo.transaction():
        for b in chosen:
            repo.put("bid", b.id, b, parent=item_id)
            repo.delete("scripted_bid", b.id)
        live = len(repo.fetch("bid", parent=item_id))
        new_state = "bids_in" if eligibility.check_bids(live).eligible else "awaiting_bids"
        lifecycle.require_transition(item.state, new_state)
        return _save(repo, item.model_copy(update={"state": new_state}))


def analyze(repo: Repo, item_id: str) -> Item:
    item = _item(repo, item_id)
    lifecycle.require_transition(item.state, "analyzed")
    return _save(repo, item.model_copy(update={"state": "analyzed"}))
