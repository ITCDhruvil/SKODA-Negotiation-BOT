from app import eligibility as el


def test_value_inside_band_is_eligible():
    assert el.check_value(318_200).eligible
    assert el.check_value(825_000).eligible


def test_value_edges_are_inclusive():
    assert el.check_value(2_000).eligible
    assert el.check_value(1_000_000).eligible


def test_value_below_min_is_ineligible_with_reason():
    r = el.check_value(1_000)
    assert not r.eligible
    assert "below" in r.reason


def test_value_above_max_is_ineligible_with_reason():
    r = el.check_value(1_100_000)
    assert not r.eligible
    assert "above" in r.reason


def test_phase_1_upper_limit_is_3_5_lakh():
    assert el.check_value(350_000, el.PHASE_1).eligible
    assert not el.check_value(350_001, el.PHASE_1).eligible


def test_min_bids_per_phase():
    assert not el.check_bids(1, el.PHASE_1).eligible
    assert el.check_bids(2, el.PHASE_1).eligible
    assert not el.check_bids(2, el.PHASE_2).eligible
    assert el.check_bids(3, el.PHASE_2).eligible


def test_bids_reason_names_the_minimum():
    assert "3" in el.check_bids(2).reason


def test_default_band_is_phase_2():
    assert el.DEFAULT_BAND is el.PHASE_2
