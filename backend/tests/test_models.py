from datetime import date

import pytest
from pydantic import ValidationError

from app.models import Bid, Dataset, Event, Item, Vendor


def _event(eid="AIS-E1-2026-00037"):
    return Event(
        id=eid, type="shopping_cart", direction="buy", title="t", company_id="0800",
        company="SKODA Auto VW India", plant="Plant Pune", purch_org="LPOS", purch_group="A05",
        category="25200000 - Catering", category_key="25200000", requestor="X", cost_centre="1",
        created=date(2026, 8, 1), approval_date=date(2026, 8, 2), due=date(2026, 9, 1),
        source_cart_no="1", hero=False, acceptable=False, no_deal=False, stage="draft",
    )


def _item(iid, qty, ref):
    return Item(
        id=iid, event_id="AIS-E1-2026-00037", position=1, description="d", kind="goods", qty=qty,
        unit="EA", reference_price=ref, suggested_target=1, suggested_limit=2, target=None,
        limit=None, incoterm="FH", delivery_days=5, state="draft",
    )


def test_extra_fields_are_rejected():
    with pytest.raises(ValidationError):
        Vendor(id="V1", name="n", sap_no="1", type="supplier", categories=[], rating=4.0,
               payment_pref="ZD30", past_deals=1, bogus=1)


def test_event_value_sums_qty_times_reference_price():
    ds = Dataset(
        vendors=[], events=[_event()], items=[_item("a", 10, 5.5), _item("b", 2, 100)],
        bids=[], scripted_bids=[], outcomes=[], history=[], reserves={},
    )
    assert ds.event_value("AIS-E1-2026-00037") == 255.0


def test_item_bids_splits_live_and_scripted():
    b1 = Bid(id="b1", item_id="a", vendor_id="V1", unit_price=1, payment_code="ZD30",
             incoterm="FH", delivery_days=1, validity_days=30, warranty_months=0)
    b2 = b1.model_copy(update={"id": "b2"})
    ds = Dataset(vendors=[], events=[], items=[], bids=[b1], scripted_bids=[b2], outcomes=[],
                 history=[], reserves={})
    assert [b.id for b in ds.item_bids("a")] == ["b1"]
    assert [b.id for b in ds.item_bids("a", scripted=True)] == ["b2"]


def test_dataset_json_round_trip():
    ds = Dataset(vendors=[], events=[_event()], items=[_item("a", 1, 1)], bids=[],
                 scripted_bids=[], outcomes=[], history=[], reserves={})
    assert Dataset.model_validate_json(ds.model_dump_json()) == ds


def test_bid_has_no_reserve_field():
    assert "reserve" not in Bid.model_fields
