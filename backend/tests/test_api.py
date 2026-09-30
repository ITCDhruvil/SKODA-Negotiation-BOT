import re

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


@pytest.fixture
def client(repo: Repo):
    return TestClient(create_app(repo, seed_dataset=None))


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_dashboard_shape(client):
    d = client.get("/api/dashboard").json()
    assert d["kpis"]["total_events"] == 85 and len(d["events"]) == 85
    assert set(d["status_distribution"]) == {"received", "in_progress", "closed"}


def test_event_list_filters(client):
    all_events = client.get("/api/events").json()
    assert len(all_events) == 85
    sells = client.get("/api/events", params={"direction": "sell"}).json()
    assert sells and all(e["direction"] == "sell" for e in sells) and len(sells) == 25
    closed = client.get("/api/events", params={"status": "closed"}).json()
    assert len(closed) == 4
    hit = client.get("/api/events", params={"q": "aluminium turnings"}).json()
    assert any(e["id"] == "EVT-2026-052" for e in hit)
    assert client.get("/api/events", params={"direction": "swap"}).status_code == 422


def test_event_detail_and_404(client):
    d = client.get("/api/events/EVT-2026-041").json()
    assert d["event"]["item_count"] == 6 and len(d["items"]) == 6
    assert client.get("/api/events/NOPE").status_code == 404
    assert client.get("/api/items/NOPE").status_code == 404
    assert client.get("/api/vendors/NOPE").status_code == 404


def test_hero_buy_flow_over_http(client):
    d = client.get(f"/api/items/{BUY}").json()
    assert d["item"]["state"] == "draft" and len(d["invitees"]) == 5
    assert d["comparison"]["rows"] == []  # unreleased bid prices stay hidden

    r = client.put(f"/api/items/{BUY}/points",
                   json={"target": 280, "limit": 270, "objective": "reduce_price"})
    assert r.status_code == 409  # ceiling below target is inconsistent for a buy
    r = client.put(f"/api/items/{BUY}/points",
                   json={"target": 250, "limit": 270, "objective": "reduce_price"})
    assert r.status_code == 200 and r.json()["item"]["points_set"]
    assert client.post(f"/api/items/{BUY}/release-bids", json={}).status_code == 409
    r = client.post(f"/api/items/{BUY}/confirm-points")
    assert r.status_code == 200 and r.json()["item"]["state"] == "points_reviewed"

    vendors = [i["vendor_id"] for i in d["invitees"]]
    r = client.post(f"/api/items/{BUY}/release-bids", json={"vendor_ids": vendors[:2]})
    assert r.json()["item"]["state"] == "awaiting_bids"
    assert r.json()["bids_eligibility"]["eligible"] is False
    r = client.post(f"/api/items/{BUY}/release-bids", json={"vendor_ids": None})
    assert r.json()["item"]["state"] == "bids_in"
    assert client.post(f"/api/items/{BUY}/confirm-points").status_code == 409

    r = client.post(f"/api/items/{BUY}/analyze")
    body = r.json()
    assert r.status_code == 200 and body["item"]["state"] == "analyzed"
    assert body["comparison"]["summary"]["best_price"] == 285
    assert body["comparison"]["summary"]["potential_delta"] == 21000
    assert body["item"]["recommendation"] == "negotiate"
    assert client.post(f"/api/items/{BUY}/analyze").status_code == 409

    dash = client.get("/api/dashboard").json()
    assert BUY in {o["item_id"] for o in dash["opportunities"]}


def test_hero_sell_flow_over_http(client):
    client.put(f"/api/items/{SELL}/points", json={"target": 170, "limit": 165})
    client.post(f"/api/items/{SELL}/confirm-points")
    client.post(f"/api/items/{SELL}/release-bids", json={})
    body = client.post(f"/api/items/{SELL}/analyze").json()
    assert body["comparison"]["summary"]["best_price"] == 163
    assert body["comparison"]["summary"]["potential_delta"] == 35000


def test_history_and_comparison_routes(client):
    h = client.get(f"/api/items/{BUY}/history").json()
    assert h["basis"] == "description" and h["stats"]["count"] == 6
    c = client.get(f"/api/items/{BUY}/comparison").json()
    assert c["rows"] == []


def test_simulate_and_reset(client):
    r = client.post("/api/events/simulate", json={"direction": "sell"})
    assert r.status_code == 200 and r.json()["event"]["id"] == "EVT-2026-086"
    assert client.get("/api/dashboard").json()["kpis"]["total_events"] == 86
    assert client.post("/api/events/simulate", json={"direction": "swap"}).status_code == 422
    assert client.post("/api/admin/reset").json() == {"events": 85}
    assert client.get("/api/dashboard").json()["kpis"]["total_events"] == 85


def test_vendor_routes(client):
    vs = client.get("/api/vendors").json()
    assert len(vs) == 46
    d = client.get(f"/api/vendors/{vs[0]['id']}").json()
    assert d["vendor"]["id"] == vs[0]["id"]


def test_cors_allows_the_frontend_origin(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_no_response_ever_contains_a_reserve(client, seed_dataset: Dataset):
    paths = ["/api/dashboard", "/api/events", "/api/vendors"]
    paths += [f"/api/events/{e.id}" for e in seed_dataset.events]
    sample = seed_dataset.items[::6] + [i for i in seed_dataset.items if i.event_id in
                                        ("EVT-2026-041", "EVT-2026-052")]
    for i in sample:
        paths += [f"/api/items/{i.id}", f"/api/items/{i.id}/comparison",
                  f"/api/items/{i.id}/history"]
    paths += [f"/api/vendors/{v.id}" for v in seed_dataset.vendors[::5]]
    for p in paths:
        text = client.get(p).text
        assert "reserve" not in text.lower(), p


def test_released_prices_appear_only_after_release(client, seed_dataset: Dataset):
    scripted = [b for b in seed_dataset.scripted_bids if b.item_id == BUY]
    before = client.get(f"/api/items/{BUY}").text
    assert not any(f'"unit_price":{b.unit_price:g}' in before.replace(" ", "") for b in scripted)


def test_openapi_has_no_reserve_field(client):
    schema = client.get("/openapi.json").text
    assert not re.search(r'"reserve', schema)
