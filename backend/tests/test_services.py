import pytest

from app import lifecycle, services as sv
from app import readmodel as rm
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


def _state(repo, item_id):
    return repo.get("item", item_id).state


def test_set_points_stores_target_limit_and_objective(repo: Repo):
    item = sv.set_points(repo, BUY, target=250, limit=270, objective="reduce_price")
    assert (item.target, item.limit, item.objective) == (250, 270, "reduce_price")
    assert repo.get("item", BUY).target == 250 and _state(repo, BUY) == "draft"


def test_set_points_is_direction_aware(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, BUY, target=280, limit=270)  # buy target above ceiling
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, SELL, target=160, limit=165)  # sell target below floor
    assert sv.set_points(repo, SELL, target=170, limit=165).limit == 165


def test_confirm_needs_points_first(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.confirm_points(repo, BUY)


def test_confirm_moves_to_points_reviewed_and_is_then_idempotent(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    assert sv.confirm_points(repo, BUY).state == "points_reviewed"
    assert sv.confirm_points(repo, BUY).state == "points_reviewed"


def test_confirm_from_any_later_state_is_an_invalid_transition(repo: Repo):
    _walk_to_analyzed(repo, BUY, 250, 270)
    with pytest.raises(lifecycle.InvalidTransition):
        sv.confirm_points(repo, BUY)


def test_points_can_be_edited_after_analysis_but_not_once_bids_are_in(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    sv.release_bids(repo, BUY)
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, BUY, target=251, limit=270)  # bids_in
    sv.analyze(repo, BUY)
    item = sv.set_points(repo, BUY, target=251, limit=270)
    assert item.state == "analyzed" and item.target == 251


def test_release_before_confirm_is_rejected(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.release_bids(repo, BUY)


def test_partial_release_waits_for_minimum_bids(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    invitees = [b.vendor_id for b in repo.fetch("scripted_bid", parent=BUY)]
    item = sv.release_bids(repo, BUY, invitees[:2])
    assert item.state == "awaiting_bids" and len(repo.fetch("bid", parent=BUY)) == 2
    assert len(repo.fetch("scripted_bid", parent=BUY)) == 3
    item = sv.release_bids(repo, BUY, invitees[2:3])
    assert item.state == "bids_in"  # third bid meets the minimum of 3


def test_release_all_defaults_and_keeps_reserves(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    reserves_before = repo.reserves()
    assert sv.release_bids(repo, BUY).state == "bids_in"
    assert repo.fetch("scripted_bid", parent=BUY) == []
    assert repo.reserves() == reserves_before


def test_release_unknown_vendor_is_rejected(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    with pytest.raises(sv.Conflict):
        sv.release_bids(repo, BUY, ["V999"])


def _walk_to_analyzed(repo, item_id, target, limit):
    sv.set_points(repo, item_id, target=target, limit=limit, objective="reduce_price")
    sv.confirm_points(repo, item_id)
    sv.release_bids(repo, item_id)
    return sv.analyze(repo, item_id)


def test_hero_buy_walks_to_analyzed_with_expected_opportunity(repo: Repo):
    assert _walk_to_analyzed(repo, BUY, 250, 270).state == "analyzed"
    view = rm.item_view(rm.snapshot(repo), repo.get("item", BUY))
    assert (view.best_bid, view.gap, view.potential_delta) == (285, 35, 21000)
    assert view.recommendation == "negotiate" and view.points_set


def test_hero_sell_walks_to_analyzed_with_expected_opportunity(repo: Repo):
    _walk_to_analyzed(repo, SELL, 170, 165)
    view = rm.item_view(rm.snapshot(repo), repo.get("item", SELL))
    assert (view.best_bid, view.gap, view.potential_delta) == (163, 7, 35000)


def test_analyze_needs_bids_in(repo: Repo):
    with pytest.raises(lifecycle.InvalidTransition):
        sv.analyze(repo, BUY)


def test_ineligible_event_cannot_be_confirmed(repo: Repo):
    snap = rm.snapshot(repo)
    bad = next(e for e in snap.events if not rm.event_view(snap, e).eligibility.eligible)
    item = snap.items_by_event[bad.id][0]
    sv.set_points(repo, item.id, target=item.suggested_target, limit=item.suggested_limit)
    with pytest.raises(sv.Conflict) as exc:
        sv.confirm_points(repo, item.id)
    assert "value" in str(exc.value)


def test_unknown_item_is_not_found(repo: Repo):
    with pytest.raises(sv.NotFound):
        sv.set_points(repo, "NOPE", target=1, limit=2)
