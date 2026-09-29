from datetime import date
from pathlib import Path

import pytest

from app.importer import COLUMNS, RAW_HEADERS, parse_report, parse_text, render_report

SAMPLE = Path(__file__).resolve().parents[2] / "data" / "samples" / "open_shopping_cart_report.csv"


def test_headers_are_30_and_stripped_names_have_no_padding():
    assert len(RAW_HEADERS) == 30
    assert all(c == c.strip() for c in COLUMNS)


def test_parse_real_sample_positions():
    ps = parse_report(SAMPLE).positions
    assert [p.cart_no for p in ps] == ["1012358189"] * 3 + ["1012360129", "1012360241"]
    assert [p.pos for p in ps] == [1, 2, 3, 1, 1]
    assert [p.inr_value for p in ps] == [26000, 20000, 20000, 35000, 15000]
    assert ps[0].eclass_code == "25200000"
    assert ps[0].eclass_name == "Gastronomie Und Bewirtung (Dienstleistung)"
    assert ps[0].value_type == "CTM (<10k €)"
    assert ps[3].order_for_id == "9790"
    assert ps[4].qty_unit == "EA"


def test_dates_follow_the_column_formats():
    p = parse_report(SAMPLE).positions[0]
    assert p.create_date == date(2025, 4, 1)
    assert p.approval_date == date(2025, 4, 2)  # column is D/M/YYYY (A46)
    assert p.delivery_to == date(2025, 5, 31)


def test_meal_rows_are_flagged_as_shifted_not_silently_fixed():
    r = parse_report(SAMPLE)
    assert [w.kind for w in r.warnings] == ["shifted_qty"] * 3
    first = r.positions[0]
    assert first.qty == 26000 and first.inr_unit_price == 1  # raw values kept
    assert first.net_qty == 1 and first.net_unit_price == 26000


def test_good_rows_produce_no_warnings():
    r = parse_report(SAMPLE)
    assert {w.cart_no for w in r.warnings} == {"1012358189"}


def test_round_trip_is_lossless():
    r1 = parse_report(SAMPLE)
    r2 = parse_text(render_report(r1.positions))
    assert r2.positions == r1.positions


def test_bad_header_raises():
    with pytest.raises(ValueError):
        parse_text("a,b,c\n1,2,3\n")


def test_wrong_column_count_raises():
    header = ",".join(RAW_HEADERS)
    with pytest.raises(ValueError):
        parse_text(header + "\r\n1,2,3\r\n")


def test_value_mismatch_is_warned():
    ps = parse_report(SAMPLE).positions
    bad = ps[4].__class__(**{**ps[4].__dict__, "qty": 3.0})
    r = parse_text(render_report([bad]))
    assert [w.kind for w in r.warnings] == ["value_mismatch"]
