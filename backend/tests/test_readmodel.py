import pytest

from app import deal, lifecycle, readmodel as rm
from app.models import Dataset
from app.store import Repo

HERO_BUY_ITEM = "EVT-2026-041-01"
HERO_SELL_EVENT = "EVT-2026-052"


@pytest.fixture
def snap(repo: Repo):
    return rm.snapshot(repo)


def test_snapshot_indexes(snap, seed_dataset: Dataset):
    assert len(snap.events) == 85 and len(snap.item_by_id) == len(seed_dataset.items)
    assert len(snap.items_by_event["EVT-2026-041"]) == 6
    assert HERO_BUY_ITEM in snap.item_by_id


def test_hero_buy_item_before_bids(snap):
    v = rm.item_view(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert v.state == "draft" and not v.points_set
    assert (v.target, v.limit) == (250, 270)  # suggested points until the buyer sets them
    assert v.bid_count == 0 and v.best_bid is None and v.potential_delta is None
    assert v.recommendation == "waiting" and v.value == 168000  # 600 x reference 280


def test_hero_sell_event_before_bids(snap):
    e = rm.event_view(snap, snap.event_by_id[HERO_SELL_EVENT])
    assert e.status == "received" and e.eligibility.eligible
    assert e.reference_value == 825000 and e.potential_delta == 0
    assert e.vendor_count == 5


def test_hero_buy_event_totals(snap):
    e = rm.event_view(snap, snap.event_by_id["EVT-2026-041"])
    assert e.item_count == 6 and e.vendor_count == 5
    assert e.reference_value == 318200 and e.quoted_value == 318200
    assert e.status == "received" and e.direction == "buy"


def test_item_views_are_consistent_with_deal_for_every_item(snap):
    for item in snap.items:
        v = rm.item_view(snap, item)
        d = snap.event_by_id[item.event_id].direction
        bids = snap.bids_by_item.get(item.id, [])
        assert v.bid_count == len(bids)
        if bids:
            best = deal.best_price(d, [b.unit_price for b in bids])
            assert v.best_bid == best
            assert v.gap == deal.gap_to_target(d, best, v.target)
            if item.state != "closed":
                assert v.potential_delta == deal.potential_delta(d, best, v.target, item.qty)
            assert v.value == deal.value(item.qty, best)
        else:
            assert v.best_bid is None and v.recommendation in ("waiting", "done")


def test_event_status_matches_lifecycle_and_closed_count(snap):
    statuses = {}
    for e in snap.events:
        ev = rm.event_view(snap, e)
        assert ev.status == lifecycle.event_status(i.state for i in snap.items_by_event[e.id])
        statuses[e.id] = ev.status
    assert sum(1 for s in statuses.values() if s == "closed") == 4


def test_ineligible_events_are_flagged(snap):
    bad = [e for e in snap.events if not rm.event_view(snap, e).eligibility.eligible]
    assert len(bad) == 7  # 4 carts + 3 lots
    assert all("value" in rm.event_view(snap, e).eligibility.reason for e in bad)


def _first_analyzed(snap, direction):
    for item in snap.items:
        e = snap.event_by_id[item.event_id]
        if item.state == "analyzed" and e.direction == direction and not e.acceptable:
            return item
    raise AssertionError("no analyzed item")


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_comparison_orders_best_effective_first(snap, direction):
    item = _first_analyzed(snap, direction)
    c = rm.comparison(snap, item)
    assert len(c.rows) >= 3 and c.summary.direction == direction
    eff = [r.effective_price for r in c.rows]
    assert eff == deal.best_first(direction, eff)
    assert sum(1 for r in c.rows if r.is_best_effective) >= 1
    best = deal.best_price(direction, [r.unit_price for r in c.rows])
    assert c.summary.best_price == best
    assert [r.unit_price for r in c.rows if r.is_best_price][0] == best
    assert c.summary.opportunity is True and c.summary.potential_delta > 0
    assert c.summary.spread == deal.bid_spread([r.unit_price for r in c.rows])


def test_comparison_of_item_without_bids_is_empty(snap):
    c = rm.comparison(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert c.rows == [] and c.summary.best_price is None and c.summary.opportunity is False


def test_history_for_hero_item_matches_by_description(snap):
    h = rm.history_view(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert h.basis == "description" and h.stats.count == 6
    assert all(262 <= r.unit_price <= 275 for r in h.records)
    assert [r.date for r in h.records] == sorted(r.date for r in h.records)
    assert h.last_negotiated is not None


def test_history_falls_back_to_category(snap):
    item = next(i for i in snap.items if i.description == "Meals For Training Batch"
                or i.event_id == "EVT-2026-041" and i.position == 2)
    h = rm.history_view(snap, snap.item_by_id["EVT-2026-041-02"])
    assert h.stats.count >= 2 and item is not None


def test_outcome_view_carries_derived_delta(snap):
    o = next(o for o in snap.outcomes.values() if o.negotiated)
    v = rm.outcome_view(snap, o)
    d = snap.event_by_id[snap.item_by_id[o.item_id].event_id].direction
    assert v.value_delta == deal.realised_delta(d, o.original_price, o.final_price, o.qty) > 0


def test_item_detail_hides_scripted_prices_and_lists_invitees(snap):
    d = rm.item_detail(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert len(d.invitees) == 5 and d.comparison.rows == [] and d.outcome is None
    dumped = d.model_dump_json()
    assert "unit_price" not in dumped.split('"comparison"')[0].split('"invitees"')[1]
