import random
from datetime import timedelta

from app import deal, eligibility
from app.seed.constants import SEED, TODAY
from app.seed.history import build_history
from app.seed.scrap import make_lots
from app.seed.vendors import build_vendors


def test_lot_count_and_bands():
    lots = make_lots(random.Random(SEED))
    assert len(lots) == 24
    bad = [i for i, l in enumerate(lots) if not eligibility.check_value(l.qty * l.ref).eligible]
    assert bad == [1, 7, 14]


def test_lot_prices_stay_in_material_ranges():
    for l in make_lots(random.Random(SEED)):
        assert l.material.price_lo <= l.ref <= l.material.price_hi


def test_history_size_and_window():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    assert len(hs) >= 200
    assert len({h.id for h in hs}) == len(hs)
    for h in hs:
        assert TODAY - timedelta(days=560) <= h.closed_date <= TODAY - timedelta(days=1)
    assert [h.closed_date for h in hs] == sorted(h.closed_date for h in hs)


def test_history_vendors_exist_and_serve_the_category():
    vs = {v.id: v for v in build_vendors(random.Random(SEED))}
    for h in build_history(random.Random(SEED), list(vs.values())):
        assert h.category_key in vs[h.vendor_id].categories


def test_negotiated_rows_show_a_clear_gain():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    negotiated = [h for h in hs if h.negotiated]
    assert len(negotiated) >= 60
    for h in negotiated:
        assert h.original_price is not None
        assert deal.realised_delta(h.direction, h.original_price, h.unit_price, h.qty) > 0
    assert all(h.original_price is None for h in hs if not h.negotiated)


def test_hero_materials_have_history():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    for name in ("Delegation Lunch Buffet", "Aluminium Turnings"):
        assert len([h for h in hs if h.description == name]) == 6
