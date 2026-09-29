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
