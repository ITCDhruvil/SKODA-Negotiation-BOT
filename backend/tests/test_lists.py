import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_items_list_covers_every_item_and_carries_event_context(client, seed_dataset: Dataset):
    rows = client.get("/api/items").json()
    assert len(rows) == len(seed_dataset.items) == 189
    r = rows[0]
    assert {"event_title", "direction", "category", "category_key", "event_status"} <= set(r)
    deltas = [x["potential_delta"] or 0 for x in rows]
    assert deltas == sorted(deltas, reverse=True)


def test_items_list_filters(client, seed_dataset: Dataset):
    with_bids = {b.item_id for b in seed_dataset.bids}
    got = client.get("/api/items", params={"has_bids": "true"}).json()
    assert {r["id"] for r in got} == with_bids
    none = client.get("/api/items", params={"has_bids": "false"}).json()
    assert len(none) == len(seed_dataset.items) - len(with_bids)
    neg = client.get("/api/items", params={"recommendation": "negotiate"}).json()
    assert neg and all(r["recommendation"] == "negotiate" for r in neg)
    ev = client.get("/api/items", params={"event_id": "EVT-2026-041"}).json()
    assert len(ev) == 6 and all(r["event_id"] == "EVT-2026-041" for r in ev)
    sells = client.get("/api/items", params={"direction": "sell"}).json()
    assert sells and all(r["direction"] == "sell" for r in sells)
    hit = client.get("/api/items", params={"q": "lunch buffet"}).json()
    assert any(r["id"] == "EVT-2026-041-01" for r in hit)
    assert client.get("/api/items", params={"recommendation": "bogus"}).status_code == 422


def test_history_list(client, seed_dataset: Dataset):
    rows = client.get("/api/history").json()
    assert len(rows) == len(seed_dataset.history) == 305
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates, reverse=True)
    assert {"vendor_name", "direction", "category_key", "unit", "value_delta"} <= set(rows[0])


def test_history_filters_and_limit(client):
    sells = client.get("/api/history", params={"direction": "sell"}).json()
    assert sells and all(r["direction"] == "sell" for r in sells)
    neg = client.get("/api/history", params={"negotiated": "true"}).json()
    assert neg and all(r["negotiated"] and r["value_delta"] > 0 for r in neg)
    plain = client.get("/api/history", params={"negotiated": "false"}).json()
    assert all(r["value_delta"] is None for r in plain)
    hit = client.get("/api/history", params={"q": "aluminium turnings"}).json()
    assert len(hit) == 6
    assert len(client.get("/api/history", params={"limit": 10}).json()) == 10
    assert client.get("/api/history", params={"limit": 0}).status_code == 422
    assert client.get("/api/history", params={"limit": 5000}).status_code == 422


def test_list_responses_never_contain_a_reserve(client):
    for path in ("/api/items", "/api/history"):
        assert "reserve" not in client.get(path).text.lower()


def test_cors_origins_are_configurable(repo: Repo, seed_dataset: Dataset):
    app = create_app(repo, seed_dataset, cors_origins=["http://localhost:3100"])
    c = TestClient(app)
    ok = c.get("/api/health", headers={"Origin": "http://localhost:3100"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3100"
    other = c.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert "access-control-allow-origin" not in other.headers


def test_items_date_range_covering_everything_equals_unfiltered(client, seed_dataset: Dataset):
    created = sorted(e.created for e in seed_dataset.events)
    params = {"date_from": created[0].isoformat(), "date_to": created[-1].isoformat()}
    assert client.get("/api/items", params=params).json() == client.get("/api/items").json()


def test_items_date_range_narrows_to_events_created_in_it(client, seed_dataset: Dataset):
    created = sorted({e.created for e in seed_dataset.events})
    day = created[len(created) // 2].isoformat()
    rows = client.get("/api/items", params={"date_from": day, "date_to": day}).json()
    ids = {e.id for e in seed_dataset.events if e.created.isoformat() == day}
    assert rows and {r["event_id"] for r in rows} == ids
    assert len(rows) == sum(1 for i in seed_dataset.items if i.event_id in ids)


def test_items_date_range_rejects_inverted_range(client):
    r = client.get("/api/items", params={"date_from": "2026-05-01", "date_to": "2026-04-01"})
    assert r.status_code == 422


def test_history_points_carry_the_vendor_name(client):
    vendors = {v["id"]: v["name"] for v in client.get("/api/vendors").json()}
    rows = client.get("/api/history").json()
    assert all(r["vendor_name"] == vendors[r["vendor_id"]] for r in rows)
    item = client.get("/api/items/EVT-2026-041-01/history").json()
    assert item["records"] and all(r["vendor_name"] == vendors[r["vendor_id"]]
                                   for r in item["records"])
    vid = rows[0]["vendor_id"]
    detail = client.get(f"/api/vendors/{vid}").json()
    assert all(h["vendor_name"] == vendors[vid] for h in detail["history"])
