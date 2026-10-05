import random

from app import eligibility
from app.seed import heroes
from app.seed.carts import make_cart_positions
from app.seed.constants import SEED, TODAY


def _carts(positions):
    out = {}
    for p in positions:
        out.setdefault(p.cart_no, []).append(p)
    return out


def test_cart_and_position_counts():
    ps = make_cart_positions(random.Random(SEED))
    carts = _carts(ps)
    assert len(carts) == 59
    assert len(ps) >= 150


def test_values_are_exact_and_positions_numbered():
    for p in make_cart_positions(random.Random(SEED)):
        assert p.qty * p.inr_unit_price == p.inr_value
        assert not p.shifted
    for ps in _carts(make_cart_positions(random.Random(SEED))).values():
        assert [p.pos for p in ps] == list(range(1, len(ps) + 1))
        assert ps[0].status == "Open" and all(p.status == "" for p in ps[1:])


def test_dates_are_ordered_and_in_the_past():
    for p in make_cart_positions(random.Random(SEED)):
        assert p.create_date <= p.approval_date <= p.delivery_from <= p.delivery_to
        assert p.create_date < TODAY


def test_exactly_four_carts_are_ineligible():
    carts = _carts(make_cart_positions(random.Random(SEED)))
    bad = [c for c, ps in carts.items()
           if not eligibility.check_value(sum(p.qty * p.inr_unit_price for p in ps), eligibility.PHASE_2).eligible]
    assert len(bad) == 4


def test_hero_buy_cart():
    ps = heroes.hero_buy_positions()
    assert len(ps) == 6 and {p.cart_no for p in ps} == {heroes.HERO_BUY_CART}
    lunch = ps[0]
    assert lunch.description == "Delegation Lunch Buffet"
    assert lunch.qty == 600 and lunch.inr_unit_price == 280
    total = sum(p.qty * p.inr_unit_price for p in ps)
    assert eligibility.check_value(total, eligibility.PHASE_1).eligible


def test_hero_buy_numbers():
    item = heroes.HERO_BUY_ITEMS[0]
    assert item["prices"] == [285, 292, 298, 305, 312]
    assert (item["target"], item["limit"]) == (250, 270)
    assert item["reserves"][0] == 268


def test_hero_sell_numbers():
    h = heroes.HERO_SELL
    assert h["qty"] == 5000 and h["ref"] == 165
    assert h["prices"] == [163, 162, 161.5, 158, 154]
    assert (h["target"], h["limit"]) == (170, 165)
    assert h["reserves"][0] == 169
