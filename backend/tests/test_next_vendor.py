from fastapi.testclient import TestClient

from app.api import create_app

ITEM = "AIS-E1-2026-00077-01"


def _prepare(client):
    client.put(f"/api/items/{ITEM}/points", json={"target": 250, "limit": 270})
    client.post(f"/api/items/{ITEM}/confirm-points")
    client.post(f"/api/items/{ITEM}/release-bids", json={})
    client.post(f"/api/items/{ITEM}/analyze")


def test_next_vendors_list_the_vendors_not_yet_tried_best_first(repo, seed_dataset):
    c = TestClient(create_app(repo, seed_dataset))
    _prepare(c)
    before = c.get(f"/api/items/{ITEM}").json()["next_vendors"]
    assert len(before) >= 3
    effective = [v["effective_price"] for v in before]
    assert effective == sorted(effective)  # best first for a purchase
    first = before[0]["vendor_id"]
    c.post(f"/api/items/{ITEM}/negotiations", json={"mode": "manual", "vendor_id": first})
    after = c.get(f"/api/items/{ITEM}").json()["next_vendors"]
    assert first not in [v["vendor_id"] for v in after] and len(after) == len(before) - 1


def test_after_a_hand_back_the_next_vendor_can_be_started_without_resetting_the_item(repo, seed_dataset):
    c = TestClient(create_app(repo, seed_dataset))
    _prepare(c)
    first = c.get(f"/api/items/{ITEM}").json()["next_vendors"][0]["vendor_id"]
    sid = c.post(f"/api/items/{ITEM}/negotiations", json={"mode": "manual", "vendor_id": first}).json()["id"]
    assert c.post(f"/api/sessions/{sid}/hand-back", json={"reason": "no deal"}).status_code == 200
    detail = c.get(f"/api/items/{ITEM}").json()
    assert detail["item"]["state"] == "handed_back" and detail["next_vendors"]
    nxt = detail["next_vendors"][0]["vendor_id"]
    started = c.post(f"/api/items/{ITEM}/negotiations", json={"mode": "approve", "vendor_id": nxt})
    assert started.status_code == 200 and started.json()["vendor_id"] == nxt
    assert c.get(f"/api/items/{ITEM}").json()["item"]["state"] == "negotiating"
