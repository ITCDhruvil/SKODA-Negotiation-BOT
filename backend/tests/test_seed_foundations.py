import random

from app.seed.catalog import BUY_CATEGORIES, SCRAP_MATERIALS
from app.seed.constants import SEED
from app.seed.pricing import round_price, step
from app.seed.vendors import build_vendors, pool


def test_round_price_rules():
    assert round_price(285.4) == 285.0
    assert round_price(46.789) == 46.79
    assert step(285) == 1.0 and step(46) == 0.01


def test_catalog_shape():
    assert len(BUY_CATEGORIES) == 10
    assert len(SCRAP_MATERIALS) == 18
    assert BUY_CATEGORIES[0].eclass == "25200000 - Gastronomie Und Bewirtung (Dienstleistung)"
    for c in BUY_CATEGORIES:
        for t in c.templates:
            assert t.qty_lo <= t.qty_hi and t.price_lo <= t.price_hi


def test_vendor_counts_and_ids():
    vs = build_vendors(random.Random(SEED))
    assert len(vs) == 46
    assert len({v.id for v in vs}) == 46
    assert len({v.sap_no for v in vs}) == 46
    assert all(len(v.sap_no) == 10 and v.sap_no.isdigit() for v in vs)
    assert len([v for v in vs if v.type == "scrap_buyer"]) == 16


def test_every_category_has_enough_bidders():
    vs = build_vendors(random.Random(SEED))
    for c in BUY_CATEGORIES:
        assert len(pool(vs, c.code)) >= 5
    for m in SCRAP_MATERIALS:
        assert len(pool(vs, m.family)) >= 4
    assert len(pool(vs, "aluminium")) == 5


def test_vendor_build_is_deterministic():
    a = build_vendors(random.Random(SEED))
    b = build_vendors(random.Random(SEED))
    assert a == b
