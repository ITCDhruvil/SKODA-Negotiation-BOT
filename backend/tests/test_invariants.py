import pytest

from app import lifecycle, services as sv
from app.models import Dataset
from app.store import Repo

BUY = "AIS-E1-2026-00077-01"
HANDED_BACK = "AIS-E1-2026-00094-01"
_EXPECTED = (sv.Conflict, lifecycle.InvalidTransition, sv.NotFound)


def _assert_not_stranded(repo: Repo, item_id: str) -> None:
    item = repo.get("item", item_id)
    live = len(repo.fetch("bid", parent=item_id))
    assert item.state in lifecycle.TRANSITIONS, (item_id, item.state)
    if item.state == "points_reviewed":
        assert live == 0, (item_id, "points_reviewed with live bids")
    if live:
        assert item.state != "draft", (item_id, "live bids on a draft item")


def test_no_command_sequence_strands_any_seeded_item(repo: Repo, seed_dataset: Dataset):
    for seeded in seed_dataset.items:
        i = seeded.id
        commands = [
            lambda i=i, s=seeded: sv.set_points(
                repo, i, target=s.suggested_target, limit=s.suggested_limit),
            lambda i=i: sv.confirm_points(repo, i),
            lambda i=i: sv.release_bids(repo, i),
            lambda i=i: sv.analyze(repo, i),
            lambda i=i: sv.confirm_points(repo, i),
            lambda i=i, s=seeded: sv.set_points(
                repo, i, target=s.suggested_target, limit=s.suggested_limit),
        ]
        for command in commands:
            try:
                command()
            except _EXPECTED:
                pass
            _assert_not_stranded(repo, i)


def test_confirm_on_an_analyzed_item_is_an_invalid_transition(repo: Repo):
    analyzed = next(i for i in repo.fetch("item") if i.state == "analyzed")
    with pytest.raises(lifecycle.InvalidTransition):
        sv.confirm_points(repo, analyzed.id)
    assert repo.get("item", analyzed.id).state == "analyzed"


def test_confirm_twice_on_a_hero_item_works(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    assert sv.confirm_points(repo, BUY).state == "points_reviewed"
    assert sv.confirm_points(repo, BUY).state == "points_reviewed"


def test_editing_points_in_points_reviewed_then_confirming_again_succeeds(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    edited = sv.set_points(repo, BUY, target=245, limit=265, objective="reduce_price")
    assert edited.state == "points_reviewed" and edited.target == 245
    again = sv.confirm_points(repo, BUY)
    assert again.state == "points_reviewed" and again.limit == 265


def test_set_points_on_a_handed_back_item_returns_it_to_analyzed_keeping_bids(repo: Repo):
    before = repo.fetch("bid", parent=HANDED_BACK)
    assert repo.get("item", HANDED_BACK).state == "handed_back" and before
    item = sv.set_points(repo, HANDED_BACK, target=64000, limit=68000)
    assert item.state == "analyzed" and (item.target, item.limit) == (64000, 68000)
    assert repo.fetch("bid", parent=HANDED_BACK) == before


def test_points_are_refused_while_negotiating(repo: Repo):
    negotiating = next(i for i in repo.fetch("item") if i.state == "negotiating")
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, negotiating.id, target=negotiating.suggested_target,
                      limit=negotiating.suggested_limit)
