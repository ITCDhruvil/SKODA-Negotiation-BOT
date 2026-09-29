import pytest

from app import deal


def test_value_is_qty_times_price():
    assert deal.value(600, 285) == 171000.0


def test_best_price_is_min_for_buy_and_max_for_sell():
    assert deal.best_price("buy", [292, 285, 312]) == 285
    assert deal.best_price("sell", [162, 163, 154]) == 163


def test_best_price_rejects_empty():
    with pytest.raises(ValueError):
        deal.best_price("buy", [])


def test_within_limit_buy_is_at_or_below_ceiling():
    assert deal.within_limit("buy", 270, 270)
    assert not deal.within_limit("buy", 271, 270)


def test_within_limit_sell_is_at_or_above_floor():
    assert deal.within_limit("sell", 165, 165)
    assert not deal.within_limit("sell", 164, 165)


def test_gap_and_potential_buy_hero():
    assert deal.gap_to_target("buy", 285, 250) == 35
    assert deal.potential_delta("buy", 285, 250, 600) == 21000


def test_gap_is_zero_once_target_reached():
    assert deal.gap_to_target("buy", 240, 250) == 0
    assert deal.gap_to_target("sell", 175, 170) == 0


def test_gap_and_potential_sell_hero():
    assert deal.gap_to_target("sell", 163, 170) == 7
    assert deal.potential_delta("sell", 163, 170, 5000) == 35000


def test_realised_delta_buy_hero():
    assert deal.realised_delta("buy", 285, 270, 600) == 9000


def test_realised_delta_sell_hero():
    assert deal.realised_delta("sell", 163, 168, 5000) == 25000


def test_realised_delta_negative_when_worse():
    assert deal.realised_delta("buy", 270, 285, 10) == -150
    assert deal.realised_delta("sell", 168, 163, 10) == -50


def test_anchors_valid_buy():
    assert deal.anchors_valid("buy", target=250, limit=270, best_bid=285)
    assert not deal.anchors_valid("buy", target=250, limit=290, best_bid=285)
    assert not deal.anchors_valid("buy", target=280, limit=270, best_bid=285)


def test_anchors_valid_sell():
    assert deal.anchors_valid("sell", target=170, limit=165, best_bid=163)
    assert not deal.anchors_valid("sell", target=170, limit=160, best_bid=163)
    assert not deal.anchors_valid("sell", target=160, limit=165, best_bid=163)


def test_unknown_direction_rejected():
    with pytest.raises(ValueError):
        deal.best_price("swap", [1])


def test_payment_days_parses_codes():
    assert deal.payment_days("ZD30") == 30
    assert deal.payment_days("zd45") == 45
    assert deal.payment_days("ADV") == 0
    assert deal.payment_days("LC") == 0


def test_payment_days_rejects_unknown():
    with pytest.raises(ValueError):
        deal.payment_days("NET30")


def test_effective_price_buy_rewards_credit_and_warranty():
    eff = deal.effective_price(
        "buy", 100, payment_code="ZD30", incoterm="FH", delivery_days=30, warranty_months=12
    )
    assert eff == 98.11


def test_effective_price_buy_charges_freight_for_exw():
    exw = deal.effective_price("buy", 100, payment_code="ADV", incoterm="EXW", delivery_days=0)
    assert exw == 103.0


def test_effective_price_sell_penalises_long_credit():
    adv = deal.effective_price("sell", 100, payment_code="ADV", incoterm="EXW", delivery_days=0)
    zd60 = deal.effective_price("sell", 100, payment_code="ZD60", incoterm="EXW", delivery_days=0)
    assert adv == 100.0
    assert zd60 < adv


def test_effective_price_sell_deducts_freight_and_pickup_delay():
    eff = deal.effective_price("sell", 100, payment_code="ZD30", incoterm="FCA", delivery_days=10)
    assert eff == 98.01  # 99.0137 present value - (0.5% freight + 0.5% delay)


def test_effective_price_rejects_unknown_incoterm():
    with pytest.raises(ValueError):
        deal.effective_price("buy", 100, payment_code="ZD30", incoterm="XYZ", delivery_days=1)
