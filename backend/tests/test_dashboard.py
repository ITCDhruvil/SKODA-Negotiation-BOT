from collections import defaultdict

import pytest

from app import deal, readmodel as rm
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def dash(repo: Repo):
    return rm.dashboard(rm.snapshot(repo))


def test_counts(dash, seed_dataset: Dataset):
    k = dash.kpis
    assert k.total_events == 85 and k.items == len(seed_dataset.items)
    assert k.vendors == 46
    assert k.open_events == 81 and len(dash.events) == 85


def test_completed_and_realised_match_independent_recomputation(dash, seed_dataset: Dataset):
    direction = {e.id: e.direction for e in seed_dataset.events}
    item_event = {i.id: i.event_id for i in seed_dataset.items}
    buy = sell = 0.0
    completed = 0
    for o in seed_dataset.outcomes:
        delta = deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty)
        assert direction[item_event[o.item_id]] == o.direction
        if o.negotiated:
            completed += 1
        if o.direction == "buy":
            buy += delta
        else:
            sell += delta
    k = dash.kpis
    assert k.completed_negotiations == completed
    assert k.realised_savings == round(buy, 2) and k.realised_uplift == round(sell, 2)
    assert k.realised_total == round(buy + sell, 2)
    assert dash.delta_generated.savings == k.realised_savings
    assert dash.delta_generated.uplift == k.realised_uplift


def test_potential_matches_independent_recomputation(dash, seed_dataset: Dataset):
    by_event = {e.id: e for e in seed_dataset.events}
    pot = defaultdict(float)
    for i in seed_dataset.items:
        bids = seed_dataset.item_bids(i.id)
        if not bids or i.state == "closed":
            continue
        d = by_event[i.event_id].direction
        best = deal.best_price(d, [b.unit_price for b in bids])
        target = i.target if i.target is not None else i.suggested_target
        pot[d] += deal.potential_delta(d, best, target, i.qty)
    k = dash.kpis
    assert k.potential_savings == round(pot["buy"], 2)
    assert k.potential_uplift == round(pot["sell"], 2)
    assert k.potential_total == round(pot["buy"] + pot["sell"], 2)
    assert k.potential_total > 0


def test_negotiations_in_progress(dash, seed_dataset: Dataset):
    n = sum(1 for i in seed_dataset.items
            if i.state in ("negotiating", "result_pending", "awaiting_approval"))
    assert dash.kpis.negotiations_in_progress == n == 2


def test_value_by_category_sums_to_total_value(dash):
    assert round(sum(c.value for c in dash.value_by_category), 2) == dash.kpis.total_value
    assert abs(sum(c.share for c in dash.value_by_category) - 1.0) < 0.001
    values = [c.value for c in dash.value_by_category]
    assert values == sorted(values, reverse=True)


def test_top_vendors_are_sorted_and_use_live_bids_only(dash, seed_dataset: Dataset):
    assert 1 <= len(dash.top_vendors) <= 5
    values = [v.value for v in dash.top_vendors]
    assert values == sorted(values, reverse=True)
    qty = {i.id: i.qty for i in seed_dataset.items}
    per_vendor = defaultdict(float)
    for b in seed_dataset.bids:
        per_vendor[b.vendor_id] += qty[b.item_id] * b.unit_price
    top = dash.top_vendors[0]
    assert top.value == round(per_vendor[top.vendor_id], 2)
    assert top.value == max(round(v, 2) for v in per_vendor.values())


def test_opportunities_only_from_live_bids_and_sorted(dash):
    assert dash.opportunities
    deltas = [o.potential_delta for o in dash.opportunities]
    assert deltas == sorted(deltas, reverse=True) and all(d > 0 for d in deltas)
    assert all(o.state in ("bids_in", "analyzed", "points_reviewed", "awaiting_bids")
               for o in dash.opportunities)
    assert "EVT-2026-041-01" not in {o.item_id for o in dash.opportunities}


def test_status_distribution(dash):
    s = dash.status_distribution
    assert s["received"] + s["in_progress"] + s["closed"] == 85 and s["closed"] == 4


def test_insight_names_the_widest_bid_spread(dash):
    assert dash.insight is not None and dash.insight.spread > 0.05


def test_vendor_views(repo: Repo):
    snap = rm.snapshot(repo)
    vendors = [rm.vendor_view(snap, v) for v in snap.vendors.values()]
    assert len(vendors) == 46
    assert sum(v.live_bid_count for v in vendors) == len(repo.fetch("bid"))
    v = next(v for v in snap.vendors.values() if v.type == "supplier")
    detail = rm.vendor_detail(snap, v)
    assert detail.vendor.id == v.id
    assert all(h.vendor_id == v.id for h in detail.history)
    assert len(detail.recent_bids) <= 20
