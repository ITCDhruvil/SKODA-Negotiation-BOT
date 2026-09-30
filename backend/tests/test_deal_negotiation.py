import pytest

from app import deal


def test_opposite():
    assert deal.opposite("buy") == "sell"
    assert deal.opposite("sell") == "buy"
    with pytest.raises(ValueError):
        deal.opposite("swap")


def test_round_price_rounds_half_up_and_keeps_paise_below_100():
    assert deal.round_price(274.5) == 275.0
    assert deal.round_price(165.8) == 166.0
    assert deal.round_price(46.789) == 46.79
    assert deal.round_price(99.995) == 100.0


def test_concede_moves_toward_the_other_side_for_a_buyer():
    # we (buy) offer 250; vendor asks 275; we move 40% of the way
    assert deal.concede("buy", 250, 275, 270, 0.4) == 260.0


def test_concede_never_passes_the_movers_bound_buy():
    assert deal.concede("buy", 250, 400, 270, 0.9) == 270.0


def test_concede_moves_a_seller_down_and_respects_the_floor():
    assert deal.concede("sell", 170, 166, 165, 0.4) == 168.0
    assert deal.concede("sell", 170, 100, 165, 0.9) == 165.0


def test_concede_for_the_vendor_side_uses_the_opposite_direction():
    # in a buy event the vendor sells: comes down from 285 toward our 250 but never below 268
    assert deal.concede("sell", 285, 250, 268, 0.3) == 275.0
    assert deal.concede("sell", 271, 264, 268, 0.9) == 268.0
    # in a sell event the vendor buys: comes up from 163 toward our 170 but never above 169
    assert deal.concede("buy", 163, 170, 169, 0.4) == 166.0


def test_concede_rejects_bad_fraction():
    with pytest.raises(ValueError):
        deal.concede("buy", 1, 2, 3, 1.5)


def test_payment_ladder_moves_the_right_way_for_each_side():
    assert deal.next_better_payment("buy", "ZD30") == "ZD45"
    assert deal.next_better_payment("buy", "ZD60") is None
    assert deal.next_better_payment("sell", "ZD30") == "ZD15"
    assert deal.next_better_payment("sell", "ADV") is None
    assert deal.next_better_payment("sell", "LC") is None
    assert deal.next_better_payment("buy", "ADV") == "ZD15"


def test_better_payment_compares_days_by_direction():
    assert deal.better_payment("buy", "ZD45", "ZD30")
    assert not deal.better_payment("buy", "ZD30", "ZD45")
    assert deal.better_payment("sell", "ADV", "ZD30")
    assert not deal.better_payment("sell", "ZD30", "ZD30")
