import pytest

from app import lifecycle as lc
from app.models import Dataset


def test_happy_path_is_allowed_step_by_step():
    path = ["draft", "points_reviewed", "bids_in", "analyzed", "negotiating",
            "result_pending", "awaiting_approval", "closed"]
    for a, b in zip(path, path[1:]):
        assert lc.can_transition(a, b), (a, b)


def test_continue_negotiation_and_hand_back():
    assert lc.can_transition("result_pending", "negotiating")
    assert lc.can_transition("negotiating", "handed_back")
    assert lc.can_transition("handed_back", "analyzed")
    assert lc.can_transition("handed_back", "closed")


def test_nothing_can_strand_an_item_back_at_points_reviewed():
    assert not lc.can_transition("analyzed", "points_reviewed")
    assert not lc.can_transition("handed_back", "points_reviewed")
    assert lc.TRANSITIONS["handed_back"] == frozenset({"analyzed", "closed"})
    assert lc.TRANSITIONS["analyzed"] == frozenset({"negotiating", "awaiting_approval"})


def test_bids_can_trickle_in():
    assert lc.can_transition("points_reviewed", "awaiting_bids")
    assert lc.can_transition("awaiting_bids", "awaiting_bids")
    assert lc.can_transition("awaiting_bids", "bids_in")


def test_illegal_transitions_are_rejected():
    for a, b in [("draft", "analyzed"), ("analyzed", "closed"), ("closed", "draft"),
                 ("bids_in", "negotiating"), ("draft", "negotiating"),
                 ("analyzed", "points_reviewed"), ("handed_back", "points_reviewed")]:
        assert not lc.can_transition(a, b)
        with pytest.raises(lc.InvalidTransition):
            lc.require_transition(a, b)


def test_every_state_has_an_entry_and_closed_is_terminal():
    assert set(lc.TRANSITIONS) == {
        "draft", "points_reviewed", "awaiting_bids", "bids_in", "analyzed", "negotiating",
        "result_pending", "awaiting_approval", "closed", "handed_back"}
    assert lc.TRANSITIONS["closed"] == frozenset()


def test_event_status_is_derived_from_item_states():
    assert lc.event_status(["draft", "draft"]) == "received"
    assert lc.event_status(["closed", "closed"]) == "closed"
    assert lc.event_status(["closed", "analyzed"]) == "in_progress"
    assert lc.event_status(["awaiting_bids"]) == "in_progress"
    assert lc.event_status(["handed_back"]) == "in_progress"
    with pytest.raises(ValueError):
        lc.event_status([])


def test_seed_item_states_are_all_known(seed_dataset: Dataset):
    assert {i.state for i in seed_dataset.items} <= set(lc.TRANSITIONS)


def test_the_best_quote_can_be_accepted_as_is_from_analyzed():
    assert lc.can_transition("analyzed", "awaiting_approval")
    assert not lc.can_transition("analyzed", "closed")
