import re

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


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


def test_openapi_has_no_reserve_field(client):
    schema = client.get("/openapi.json").text
    assert not re.search(r'"reserve', schema)


def _sweep_paths(ds: Dataset) -> list[str]:
    paths = ["/api/dashboard", "/api/events", "/api/vendors"]
    paths += [f"/api/events/{e.id}" for e in ds.events]
    sample = ds.items[::4] + [i for i in ds.items if i.id in (BUY, SELL)]
    for i in sample:
        paths += [f"/api/items/{i.id}", f"/api/items/{i.id}/comparison",
                  f"/api/items/{i.id}/history"]
    paths += [f"/api/vendors/{v.id}" for v in ds.vendors[::5]]
    return paths


def test_responses_do_not_depend_on_reserves_or_unreleased_bid_prices(seed_dataset: Dataset):
    """Metamorphic leak test: change every hidden number, no response may change."""
    plain = Repo()
    plain.load_dataset(seed_dataset)
    changed = Repo()
    changed.load_dataset(seed_dataset)
    for bid_id, value in changed.reserves().items():
        changed.put("reserve", bid_id, round(value * 3.11, 2))
    for b in changed.fetch("scripted_bid"):
        changed.put("scripted_bid", b.id,
                    b.model_copy(update={"unit_price": round(b.unit_price * 1.37, 2)}),
                    parent=b.item_id)
    assert changed.reserves() != plain.reserves()
    assert changed.fetch("scripted_bid") != plain.fetch("scripted_bid")
    a = TestClient(create_app(plain, seed_dataset))
    b = TestClient(create_app(changed, seed_dataset))
    for path in _sweep_paths(seed_dataset):
        ra, rb = a.get(path), b.get(path)
        assert ra.status_code == rb.status_code == 200, path
        assert ra.json() == rb.json(), path
        assert "reserve" not in ra.text.lower(), path


def _file_client(tmp_path, seed_dataset: Dataset):
    repo = Repo(tmp_path / "app.db")
    repo.load_dataset(seed_dataset)
    return TestClient(create_app(repo, seed_dataset))


def test_reset_restores_the_seed_even_after_a_restart(tmp_path, seed_dataset: Dataset):
    first = _file_client(tmp_path, seed_dataset)
    first.put(f"/api/items/{BUY}/points", json={"target": 250, "limit": 270})
    first.post(f"/api/items/{BUY}/confirm-points")
    first.post(f"/api/items/{BUY}/release-bids", json={})
    assert first.post("/api/events/simulate", json={"direction": "sell"}).status_code == 200

    restarted = TestClient(create_app(Repo(tmp_path / "app.db"), seed_dataset))
    assert restarted.get(f"/api/items/{BUY}").json()["item"]["state"] == "bids_in"
    assert restarted.get("/api/events/EVT-2026-086").status_code == 200
    assert restarted.post("/api/admin/reset").json() == {"events": 85}
    assert restarted.get(f"/api/items/{BUY}").json()["item"]["state"] == "draft"
    assert restarted.get("/api/events/EVT-2026-086").status_code == 404


@pytest.mark.parametrize("raw", ['{"target": Infinity, "limit": 270}',
                                 '{"target": NaN, "limit": 270}',
                                 '{"target": 250, "limit": 1e309}',
                                 '{"target": 0, "limit": 270}',
                                 '{"target": -5, "limit": 270}',
                                 '{"target": 250, "limit": 0}',
                                 '{"target": 250, "limit": -1}'])
def test_bad_points_bodies_are_422_and_change_nothing(client, raw):
    before = client.get(f"/api/items/{BUY}").json()
    r = client.put(f"/api/items/{BUY}/points", content=raw,
                   headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert client.get(f"/api/items/{BUY}").json() == before


def test_dashboard_and_events_accept_a_date_range(client):
    everything = client.get("/api/dashboard").json()
    lo = min(e["created"] for e in everything["events"])
    hi = max(e["created"] for e in everything["events"])
    covering = client.get("/api/dashboard", params={"date_from": lo, "date_to": hi}).json()
    assert covering == everything
    day = everything["events"][40]["created"]
    narrow = client.get("/api/dashboard", params={"date_from": day, "date_to": day}).json()
    assert 0 < narrow["kpis"]["total_events"] < 85
    assert narrow["kpis"]["vendors"] == everything["kpis"]["vendors"]
    only_from = client.get("/api/dashboard", params={"date_from": day}).json()
    only_to = client.get("/api/dashboard", params={"date_to": day}).json()
    assert 0 < only_from["kpis"]["total_events"] < 85 and 0 < only_to["kpis"]["total_events"] < 85
    events = client.get("/api/events", params={"date_from": day, "date_to": day}).json()
    assert len(events) == narrow["kpis"]["total_events"]
    assert all(e["created"] == day for e in events)
    assert len(client.get("/api/events", params={"date_to": hi}).json()) == 85


def test_reversed_or_malformed_date_range_is_422(client):
    for path in ("/api/dashboard", "/api/events"):
        assert client.get(path, params={"date_from": "2026-09-01",
                                        "date_to": "2026-08-01"}).status_code == 422
        assert client.get(path, params={"date_from": "not-a-date"}).status_code == 422


def test_release_bids_body_is_optional(client):
    client.put(f"/api/items/{BUY}/points", json={"target": 250, "limit": 270})
    client.post(f"/api/items/{BUY}/confirm-points")
    r = client.post(f"/api/items/{BUY}/release-bids")
    assert r.status_code == 200 and r.json()["item"]["state"] == "bids_in"
    client.put(f"/api/items/{SELL}/points", json={"target": 170, "limit": 165})
    client.post(f"/api/items/{SELL}/confirm-points")
    r = client.post(f"/api/items/{SELL}/release-bids", json={})
    assert r.status_code == 200 and r.json()["item"]["state"] == "bids_in"


def test_search_matches_cart_number_and_item_descriptions(client, seed_dataset: Dataset):
    event = next(e for e in seed_dataset.events if e.source_cart_no)
    hit = client.get("/api/events", params={"q": event.source_cart_no}).json()
    assert event.id in {e["id"] for e in hit}
    item = seed_dataset.event_items(event.id)[0]
    word = max(item.description.split(), key=len).lower()
    hit = client.get("/api/events", params={"q": word}).json()
    assert event.id in {e["id"] for e in hit}


def test_points_without_objective_keep_it_and_null_clears_it(client):
    client.put(f"/api/items/{BUY}/points",
               json={"target": 250, "limit": 270, "objective": "reduce_price"})
    r = client.put(f"/api/items/{BUY}/points", json={"target": 251, "limit": 270})
    assert r.json()["item"]["objective"] == "reduce_price" and r.json()["item"]["target"] == 251
    r = client.put(f"/api/items/{BUY}/points",
                   json={"target": 251, "limit": 270, "objective": None})
    assert r.json()["item"]["objective"] is None


def test_handed_back_item_reopens_as_analyzed_over_http(client):
    r = client.put("/api/items/EVT-2026-058-01/points", json={"target": 64000, "limit": 68000})
    assert r.status_code == 200 and r.json()["item"]["state"] == "analyzed"
    assert r.json()["item"]["bid_count"] == 4


def test_health_and_reset_have_explicit_models(client):
    paths = client.get("/openapi.json").json()["paths"]
    for p, m in (("/api/health", "get"), ("/api/admin/reset", "post")):
        ref = paths[p][m]["responses"]["200"]["content"]["application/json"]["schema"]
        assert "$ref" in ref
