import pytest

from app import eligibility, readmodel as rm
from app.simulate import simulate_event
from app.store import Repo


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_simulated_event_is_a_fresh_eligible_draft(repo: Repo, direction):
    before_reserves = len(repo.reserves())
    event_id = simulate_event(repo, direction)
    assert event_id == "EVT-2026-086"
    snap = rm.snapshot(repo)
    ev = rm.event_view(snap, snap.event_by_id[event_id])
    assert ev.direction == direction and ev.status == "received" and ev.eligibility.eligible
    assert eligibility.check_value(ev.reference_value).eligible
    items = snap.items_by_event[event_id]
    assert items and all(i.state == "draft" and i.target is None for i in items)
    for i in items:
        scripted = snap.scripted_by_item[i.id]
        assert 3 <= len(scripted) <= 6 and snap.bids_by_item.get(i.id) is None
    assert len(repo.reserves()) > before_reserves


def test_two_simulations_get_distinct_ids_and_content(repo: Repo):
    a = simulate_event(repo, "buy")
    b = simulate_event(repo, "buy")
    assert (a, b) == ("EVT-2026-086", "EVT-2026-087")
    snap = rm.snapshot(repo)
    assert snap.event_by_id[a].title != snap.event_by_id[b].title


def test_simulation_is_deterministic_for_the_same_starting_state(seed_dataset):
    ids = []
    for _ in range(2):
        r = Repo()
        r.load_dataset(seed_dataset)
        eid = simulate_event(r, "sell")
        ids.append((eid, r.get("event", eid).title, r.fetch("item", parent=eid)[0].qty))
    assert ids[0] == ids[1]


def test_unknown_direction_is_rejected(repo: Repo):
    with pytest.raises(ValueError):
        simulate_event(repo, "swap")
