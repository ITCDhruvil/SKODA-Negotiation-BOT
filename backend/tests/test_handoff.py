from fastapi.testclient import TestClient

from app.api import create_app

CASE = {
    "case_no": "NB-E1-2026-00037", "supplier_id": "S-11", "topic": "Training Lunch Cart SC 10124",
    "target": 40_000, "limit": 46_000, "cart_no": "1012400001",
    "suppliers": [
        {"sid": "S-11", "name": "Alpha Foods", "lang": "en", "total": 52_000, "rating": 4.2, "payment_code": "ZD30"},
        {"sid": "S-12", "name": "Beta Caterers", "lang": "hi", "total": 55_000, "rating": 3.9, "payment_code": "ZD45"},
        {"sid": "S-13", "name": "Gamma Meals", "lang": "mr", "total": 58_500, "rating": 4.5, "payment_code": "ZD30"},
    ],
}


def _client(repo, seed_dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_a_case_from_ais_becomes_an_event_with_a_conversation(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json=CASE)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["event_id"] == CASE["case_no"] and out["item_id"] == "NB-E1-2026-00037-01"
    s = c.get(f"/api/sessions/{out['session_id']}").json()
    assert s["from_ais"] and s["vendor_id"] == "S-11" and s["vendor_offer"] == 52_000
    assert s["policy"]["band"] == "auto" and s["mode"] == "auto"  # below ten lakh
    item = c.get(f"/api/items/{out['item_id']}").json()
    assert item["item"]["target"] == 40_000 and item["item"]["limit"] == 46_000
    assert [v["vendor_id"] for v in item["next_vendors"]] == ["S-12", "S-13"]  # the other suppliers are the alternatives


def test_opening_the_same_case_again_reuses_the_conversation_and_never_exposes_a_floor(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    first = c.post("/api/handoff", json=CASE).json()
    again = c.post("/api/handoff", json=CASE).json()
    assert first == again
    assert "reserve" not in c.get(f"/api/sessions/{first['session_id']}").text.lower()


def test_a_second_supplier_gets_its_own_conversation_after_the_first_ends(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    first = c.post("/api/handoff", json=CASE).json()
    assert c.post(f"/api/sessions/{first['session_id']}/hand-back", json={"reason": "no deal"}).status_code == 200
    second = c.post("/api/handoff", json={**CASE, "supplier_id": "S-12"})
    assert second.status_code == 200 and second.json()["session_id"] != first["session_id"]


def test_the_buyers_minimum_must_not_exceed_the_maximum(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json={**CASE, "target": 50_000, "limit": 40_000})
    assert r.status_code == 409
