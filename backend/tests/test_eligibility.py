from app import eligibility as el


def test_value_inside_band_is_eligible():
    assert el.check_value(318_200).eligible
    assert el.check_value(825_000).eligible


def test_value_edges_are_inclusive():
    assert el.check_value(2_000).eligible
    assert el.check_value(1_000_000).eligible
    assert el.check_value(5_000_000).eligible  # EUR 50,000 at the assumed rate, still handled with a person


def test_value_below_min_is_ineligible_with_reason():
    r = el.check_value(1_000)
    assert not r.eligible
    assert "below" in r.reason


def test_value_above_max_is_ineligible_with_reason():
    r = el.check_value(5_000_001)
    assert not r.eligible
    assert "higher management" in r.reason
    assert not el.check_value(1_100_000, el.PHASE_2).eligible


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
    assert el.DEFAULT_BAND is el.LIVE_BAND  # the sample data was generated with PHASE_2; live use goes up to EUR 50,000
    assert el.PHASE_2.max_value == 1_000_000


def test_indian_digit_grouping():
    assert el.indian(0) == "0"
    assert el.indian(999) == "999"
    assert el.indian(2_000) == "2,000"
    assert el.indian(100_000) == "1,00,000"
    assert el.indian(1_234_567) == "12,34,567"
    assert el.indian(123_456_789) == "12,34,56,789"


def test_reasons_use_indian_grouping():
    assert el.check_value(999).reason == "value 999 is below the minimum 2,000"
    assert el.check_value(1_234_567, el.PHASE_2).reason == "value 12,34,567 is above the maximum 10,00,000"
    assert el.check_value(6_000_000).reason == "value 60,00,000 is above EUR 50,000, so higher management handles it"
    assert el.check_value(400_000, el.PHASE_1).reason == "value 4,00,000 is above the maximum 3,50,000"
