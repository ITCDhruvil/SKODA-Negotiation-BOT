from collections import Counter
from datetime import timedelta

import pytest

from app import deal, eligibility
from app.importer import parse_text, render_report
from app.seed import heroes
from app.seed.build import build_dataset, build_positions
from app.seed.constants import TODAY


@pytest.fixture(scope="module")
def ds():
    return build_dataset()


@pytest.fixture(scope="module")
def positions():
    return build_positions()


def _events(ds):
    return {e.id: e for e in ds.events}


def _all_bids(ds, item_id):
    return ds.item_bids(item_id) + ds.item_bids(item_id, scripted=True)


def test_scale(ds, positions):
    assert len(positions) >= 150
    assert len({p.cart_no for p in positions}) >= 60
    assert len([v for v in ds.vendors if v.type == "supplier"]) >= 25
    assert len(ds.vendors) >= 40
    assert len([v for v in ds.vendors if v.type == "scrap_buyer"]) >= 15
    assert len([e for e in ds.events if e.type == "scrap_sale"]) >= 25
    assert len([e for e in ds.events if e.type == "shopping_cart"]) == 60
    assert len(ds.history) >= 200


def test_ids_are_unique_and_heroes_fixed(ds):
    ids = [e.id for e in ds.events]
    assert len(ids) == len(set(ids)) == 85
    ev = _events(ds)
    assert ev[heroes.HERO_BUY_ID].hero and ev[heroes.HERO_BUY_ID].direction == "buy"
    assert ev[heroes.HERO_SELL_ID].hero and ev[heroes.HERO_SELL_ID].direction == "sell"


def test_csv_positions_round_trip_and_match_items(ds, positions):
    assert parse_text(render_report(positions)).positions == positions
    buy_items = [i for i in ds.items if _events(ds)[i.event_id].direction == "buy"]
    assert len(buy_items) == len(positions)


def test_no_duplicate_vendor_per_item_and_vendors_exist(ds):
    vendors = {v.id: v for v in ds.vendors}
    ev = _events(ds)
    for item in ds.items:
        bids = _all_bids(ds, item.id)
        assert len({b.vendor_id for b in bids}) == len(bids)
        for b in bids:
            assert item.event_id in ev
            assert ev[item.event_id].category_key in vendors[b.vendor_id].categories


def test_bid_counts_and_spreads(ds):
    ev = _events(ds)
    for item in ds.items:
        bids = _all_bids(ds, item.id)
        assert 3 <= len(bids) <= 6
        prices = [b.unit_price for b in bids]
        if ev[item.event_id].direction == "buy":
            assert 0.05 <= max(prices) / min(prices) - 1 <= 0.15
        else:
            assert 0.035 <= (max(prices) - min(prices)) / max(prices) <= 0.125


def test_anchor_rules(ds):
    ev = _events(ds)
    for item in ds.items:
        e = ev[item.event_id]
        best = deal.best_price(e.direction, [b.unit_price for b in _all_bids(ds, item.id)])
        t, lim = item.suggested_target, item.suggested_limit
        if e.acceptable:
            assert deal.within_limit(e.direction, best, lim)
            assert (t <= best) if e.direction == "buy" else (t > best)
        else:
            assert deal.anchors_valid(e.direction, t, lim, best), item.id
        if item.target is not None:
            assert (item.target, item.limit) == (t, lim)
        else:
            assert e.stage in ("draft",)


def test_vendor_reserves(ds):
    ev = _events(ds)
    for item in ds.items:
        e = ev[item.event_id]
        bids = sorted(_all_bids(ds, item.id), key=lambda b: b.unit_price,
                      reverse=e.direction == "sell")
        for b in bids:
            if e.direction == "buy":
                assert b.reserve <= b.unit_price
            else:
                assert b.reserve >= b.unit_price
        no_deal_item = e.no_deal and item.position == 1
        best = bids[0]
        if no_deal_item:
            for b in bids:
                assert not deal.within_limit(e.direction, b.reserve, item.suggested_limit)
        else:
            assert deal.within_limit(e.direction, best.reserve, item.suggested_limit)


def test_dates(ds):
    for e in ds.events:
        assert e.created <= e.approval_date <= e.due
    ev = _events(ds)
    for o in ds.outcomes:
        item = next(i for i in ds.items if i.id == o.item_id)
        assert ev[item.event_id].approval_date <= o.closed_date <= TODAY - timedelta(days=1)


def test_stage_mix(ds):
    c = Counter(e.stage for e in ds.events)
    assert c["closed"] == 4
    assert c["negotiating"] == 2
    assert c["handed_back"] == 2
    assert c["analyzed"] >= 8
    assert sum(1 for e in ds.events if e.acceptable) == 3
    assert sum(1 for e in ds.events if e.no_deal) == 2


def test_closed_events_have_outcomes_within_limits(ds):
    ev = _events(ds)
    closed_ids = {e.id for e in ds.events if e.stage == "closed"}
    assert {ev_id for ev_id in closed_ids} and ds.outcomes
    for o in ds.outcomes:
        item = next(i for i in ds.items if i.id == o.item_id)
        assert item.event_id in closed_ids and item.state == "closed"
        assert deal.within_limit(o.direction, o.final_price, item.limit)
        assert deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty) > 0
        assert o.original_price == deal.best_price(
            o.direction, [b.unit_price for b in ds.item_bids(o.item_id)])
    for eid in closed_ids:
        n = len(ds.event_items(eid))
        got = len([o for o in ds.outcomes if o.item_id.startswith(eid)])
        assert got == -(-n // 2)


def test_eligibility_split(ds):
    ev = _events(ds)
    bad = {e.id for e in ds.events if not eligibility.check_value(ds.event_value(e.id)).eligible}
    assert len([b for b in bad if ev[b].direction == "buy"]) == 4
    assert len([b for b in bad if ev[b].direction == "sell"]) == 3
    assert all(ev[b].stage == "draft" for b in bad)
    assert heroes.HERO_BUY_ID not in bad and heroes.HERO_SELL_ID not in bad


def test_item_states_match_event_stage(ds):
    for e in ds.events:
        states = {i.state for i in ds.event_items(e.id)}
        if e.stage in ("draft", "awaiting_bids", "analyzed", "closed"):
            assert states == {e.stage}
        else:  # negotiating / handed_back: first item in that state, any others stay analyzed
            assert e.stage in states and states <= {e.stage, "analyzed"}


def test_scripted_bids_only_before_bids_arrive(ds):
    live = {b.item_id for b in ds.bids}
    scripted = {b.item_id for b in ds.scripted_bids}
    assert not live & scripted
    ev = _events(ds)
    for item in ds.items:
        expect_scripted = ev[item.event_id].stage in ("draft", "awaiting_bids")
        assert (item.id in scripted) == expect_scripted


def test_hero_buy(ds):
    item = next(i for i in ds.items if i.id == f"{heroes.HERO_BUY_ID}-01")
    bids = ds.item_bids(item.id, scripted=True)
    assert [b.unit_price for b in bids] == [285, 292, 298, 305, 312]
    assert (item.suggested_target, item.suggested_limit, item.qty) == (250, 270, 600)
    assert deal.potential_delta("buy", 285, item.suggested_target, item.qty) == 21000
    assert deal.realised_delta("buy", 285, 270, item.qty) == 9000
    assert len(ds.event_items(heroes.HERO_BUY_ID)) == 6
    assert 300_000 <= ds.event_value(heroes.HERO_BUY_ID) <= 350_000
    assert _events(ds)[heroes.HERO_BUY_ID].stage == "draft"


def test_hero_sell(ds):
    item = ds.event_items(heroes.HERO_SELL_ID)[0]
    bids = ds.item_bids(item.id, scripted=True)
    assert [b.unit_price for b in bids] == [163, 162, 161.5, 158, 154]
    assert (item.suggested_target, item.suggested_limit, item.qty) == (170, 165, 5000)
    assert deal.potential_delta("sell", 163, 170, item.qty) == 35000
    assert deal.realised_delta("sell", 163, 168, item.qty) == 25000
    assert 800_000 <= ds.event_value(heroes.HERO_SELL_ID) <= 850_000


def test_build_is_deterministic():
    assert build_dataset().model_dump_json() == build_dataset().model_dump_json()
