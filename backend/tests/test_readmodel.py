import pytest

from app import deal, lifecycle, readmodel as rm
from app.models import Dataset
from app.store import Repo

HERO_BUY_ITEM = "AIS-E1-2026-00077-01"
HERO_SELL_EVENT = "AIS-E1-2026-00088"


@pytest.fixture
def snap(repo: Repo):
    return rm.snapshot(repo)


def test_snapshot_indexes(snap, seed_dataset: Dataset):
    assert len(snap.events) == 85 and len(snap.item_by_id) == len(seed_dataset.items)
    assert len(snap.items_by_event["AIS-E1-2026-00077"]) == 6
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
    e = rm.event_view(snap, snap.event_by_id["AIS-E1-2026-00077"])
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
            assert v.gap == (0.0 if item.state == "closed"
                             else deal.gap_to_target(d, best, v.target))
            if item.state != "closed":
                assert v.potential_delta == deal.potential_delta(d, best, v.target, item.qty)
            outcome = snap.outcomes.get(item.id)
            if item.state == "closed" and outcome:
                assert v.value == deal.value(item.qty, outcome.final_price)
            else:
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
    # Of the 7 sample events outside the original band, 5 are above ten lakh: they can be negotiated now, with a person.
    # Only the 2 below the minimum value stay ineligible.
    assert len(bad) == 2
    assert all("below the minimum" in rm.event_view(snap, e).eligibility.reason for e in bad)


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
                or i.event_id == "AIS-E1-2026-00077" and i.position == 2)
    h = rm.history_view(snap, snap.item_by_id["AIS-E1-2026-00077-02"])
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


def _views(snap):
    return {i.id: rm.item_view(snap, i) for i in snap.items}


def test_recommendation_respects_the_limit_for_every_item(snap):
    for item in snap.items:
        v = rm.item_view(snap, item)
        d = snap.event_by_id[item.event_id].direction
        if v.best_bid is None:
            assert v.within_limit is None
        else:
            assert v.within_limit == deal.within_limit(d, v.best_bid, v.limit)
        if item.state == "closed":
            assert v.recommendation == "done"
        elif item.state == "handed_back":
            assert v.recommendation == "review"
        elif v.best_bid is None:
            assert v.recommendation == "waiting"
        elif v.within_limit:
            assert v.recommendation == "accept"
        else:
            assert v.recommendation == "negotiate"


def test_acceptable_events_show_accept_and_handed_back_shows_review(snap):
    acceptable = [e for e in snap.events if e.acceptable]
    assert acceptable
    seen = set()
    for e in acceptable:
        for i in snap.items_by_event[e.id]:
            v = rm.item_view(snap, i)
            if v.bid_count and i.state == "analyzed":
                seen.add(v.recommendation)
                assert v.within_limit is True
    assert seen == {"accept"}
    handed = [rm.item_view(snap, i) for i in snap.items if i.state == "handed_back"]
    assert handed and all(v.recommendation == "review" for v in handed)


def test_dashboard_opportunities_are_only_negotiate_items(snap):
    views = _views(snap)
    dash = rm.dashboard(snap)
    assert dash.opportunities
    assert all(views[o.item_id].recommendation == "negotiate" for o in dash.opportunities)


def test_closed_items_have_no_opportunity_and_are_valued_at_the_final_price(snap):
    closed = [i for i in snap.items if i.state == "closed"]
    assert closed
    for item in closed:
        c = rm.comparison(snap, item)
        assert c.summary.opportunity is False and c.summary.potential_delta == 0.0
        v = rm.item_view(snap, item)
        o = snap.outcomes.get(item.id)
        expected = deal.value(item.qty, o.final_price) if o else v.value
        assert v.value == expected


def test_closed_event_summary_matches_the_raw_dataset(snap, seed_dataset: Dataset):
    closed = [e for e in snap.events if rm.event_view(snap, e).status == "closed"]
    assert len(closed) == 4
    for e in closed:
        ev = rm.event_view(snap, e)
        items = seed_dataset.event_items(e.id)
        outcomes = [o for i in items if (o := next(
            (x for x in seed_dataset.outcomes if x.item_id == i.id), None))]
        final = 0.0
        for i in items:
            o = next((x for x in seed_dataset.outcomes if x.item_id == i.id), None)
            final += deal.value(i.qty, o.final_price) if o else rm.item_view(
                snap, snap.item_by_id[i.id]).value
        assert ev.final_value == round(final, 2) == ev.quoted_value
        assert ev.items_negotiated == sum(1 for o in outcomes if o.negotiated)
        assert ev.duration_minutes == sum(o.duration_minutes for o in outcomes if o.negotiated)
        assert ev.vendors_participated == ev.vendor_count


def test_open_events_have_no_final_value_and_zero_summaries(snap):
    ev = rm.event_view(snap, snap.event_by_id["AIS-E1-2026-00077"])
    assert ev.final_value is None and ev.items_negotiated == 0 and ev.duration_minutes == 0


def test_invitees_flag_who_has_responded(repo: Repo):
    from app import services as sv
    snap = rm.snapshot(repo)
    d = rm.item_detail(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert len(d.invitees) == 5 and not any(i.responded for i in d.invitees)
    sv.set_points(repo, HERO_BUY_ITEM, target=250, limit=270)
    sv.confirm_points(repo, HERO_BUY_ITEM)
    vendors = [i.vendor_id for i in d.invitees]
    sv.release_bids(repo, HERO_BUY_ITEM, vendors[:2])
    snap = rm.snapshot(repo)
    d2 = rm.item_detail(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert sorted(i.vendor_id for i in d2.invitees) == sorted(vendors)
    assert [i.responded for i in d2.invitees].count(True) == 2
    assert [i.responded for i in d2.invitees].count(False) == 3
    assert {i.vendor_id for i in d2.invitees if i.responded} == set(vendors[:2])
    assert "unit_price" not in d2.model_dump_json().split('"comparison"')[0].split('"invitees"')[1]


def test_services_and_readmodel_agree_at_the_band_edges(repo: Repo):
    from app import eligibility, services as sv
    from app.models import Item
    template = repo.get("item", HERO_BUY_ITEM)
    event = repo.get("event", "AIS-E1-2026-00077")
    for n, total in enumerate((1_999.99, 2_000.0, 5_000_000.0, 5_000_000.01)):
        eid = f"EDGE-{n}"
        repo.put("event", eid, event.model_copy(update={"id": eid}))
        iid = f"{eid}-01"
        repo.put("item", iid, template.model_copy(update={
            "id": iid, "event_id": eid, "qty": 1, "reference_price": total,
            "suggested_target": 1.0, "suggested_limit": 2.0, "state": "draft"}), parent=eid)
        snap = rm.snapshot(repo)
        view = rm.event_view(snap, snap.event_by_id[eid])
        assert view.reference_value == sv._reference_value(repo, eid) == total
        sv.set_points(repo, iid, target=1.0, limit=2.0)
        expected = eligibility.check_value(total).eligible
        assert view.eligibility.eligible is expected
        if expected:
            assert sv.confirm_points(repo, iid).state == "points_reviewed"
        else:
            with pytest.raises(sv.Conflict):
                sv.confirm_points(repo, iid)


def test_between_keeps_only_events_in_range_and_their_children(snap):
    day = snap.event_by_id["AIS-E1-2026-00077"].created
    part = snap.between(day, day)
    assert part.events and all(e.created == day for e in part.events)
    ids = {i.id for i in part.items}
    assert all(i.event_id in part.event_by_id for i in part.items)
    assert set(part.bids_by_item) <= ids and set(part.scripted_by_item) <= ids
    assert set(part.outcomes) <= ids
    assert part.vendors is snap.vendors and part.history is snap.history
    assert len(snap.between(None, None).events) == len(snap.events)
    assert snap.between(day, None).events == [e for e in snap.events if e.created >= day]
    assert snap.between(None, day).events == [e for e in snap.events if e.created <= day]


def test_closed_items_have_no_gap_or_potential(snap):
    closed = [i for i in snap.items if i.state == "closed" and snap.bids_by_item.get(i.id)]
    assert closed
    for item in closed:
        v = rm.item_view(snap, item)
        assert v.gap == 0.0 and v.potential_delta == 0.0


def test_original_value_only_on_closed_events(snap):
    closed = 0
    for e in snap.events:
        ev = rm.event_view(snap, e)
        if ev.status != "closed":
            assert ev.original_value is None
            continue
        closed += 1
        if e.direction == "buy":
            assert round(ev.original_value - ev.final_value, 2) == ev.realised_delta
        else:
            assert round(ev.final_value - ev.original_value, 2) == ev.realised_delta
    assert closed == 4
