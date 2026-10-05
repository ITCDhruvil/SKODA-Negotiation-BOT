import pytest
from fastapi.testclient import TestClient

from app import policy
from app.api import create_app


def test_bands_follow_the_value_limits():
    assert policy.band(999_999) == "auto"
    assert policy.band(1_000_000) == "supervised"
    assert policy.band(policy.MANAGEMENT_LIMIT_INR) == "supervised"  # exactly EUR 50,000 is still handled with a person
    assert policy.band(policy.MANAGEMENT_LIMIT_INR + 1) == "management"
    assert policy.MANAGEMENT_LIMIT_INR == policy.MANAGEMENT_LIMIT_EUR * policy.EUR_INR


def test_each_band_has_its_default_mode_and_only_the_smallest_allows_auto():
    assert policy.default_mode("auto") == "auto"
    assert policy.default_mode("supervised") == "approve"
    assert [policy.allows_auto(b) for b in ("auto", "supervised", "management")] == [True, False, False]


def _client(repo, seed_dataset):
    return TestClient(create_app(repo, seed_dataset))


def _ready(c, item, target, limit):
    c.put(f"/api/items/{item}/points", json={"target": target, "limit": limit})
    c.post(f"/api/items/{item}/confirm-points")
    c.post(f"/api/items/{item}/release-bids", json={})
    c.post(f"/api/items/{item}/analyze")


def test_item_detail_shows_the_policy(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    p = c.get("/api/items/EVT-2026-041-01").json()["item"]["policy"]
    assert p["band"] == "auto" and p["auto_allowed"] and p["default_mode"] == "auto"
    big = c.get("/api/items/EVT-2026-063-01").json()["item"]["policy"]
    assert big["band"] == "supervised" and not big["auto_allowed"] and big["default_mode"] == "approve"


def test_full_auto_is_refused_for_a_deal_above_ten_lakh_but_approval_mode_works(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    item = "EVT-2026-063-01"
    detail = c.get(f"/api/items/{item}").json()
    if detail["item"]["state"] != "analyzed":
        _ready(c, item, detail["item"]["target"], detail["item"]["limit"])
    r = c.post(f"/api/items/{item}/negotiations", json={"mode": "auto"})
    assert r.status_code == 409 and "person stays in the loop" in r.json()["detail"]
    ok = c.post(f"/api/items/{item}/negotiations", json={"mode": "approve"})
    assert ok.status_code == 200
    sid = ok.json()["id"]
    assert c.put(f"/api/sessions/{sid}/mode", json={"mode": "auto"}).status_code == 409
    assert c.put(f"/api/sessions/{sid}/mode", json={"mode": "manual"}).status_code == 200


def test_a_deal_above_the_management_limit_cannot_be_negotiated(repo, seed_dataset, monkeypatch):
    monkeypatch.setattr(policy, "MANAGEMENT_LIMIT_INR", 100_000.0)  # make an ordinary item count as a large one
    c = _client(repo, seed_dataset)
    item = "EVT-2026-041-01"
    _ready(c, item, 250, 270)
    assert c.get(f"/api/items/{item}").json()["item"]["policy"]["band"] == "management"
    r = c.post(f"/api/items/{item}/negotiations", json={"mode": "approve"})
    assert r.status_code == 409 and "higher management" in r.json()["detail"]
