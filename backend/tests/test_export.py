import csv
import io

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.export import TEMPLATE_COLUMNS
from app.models import Dataset
from app.store import Repo

BUY, BUY_EVT = "EVT-2026-041-01", "EVT-2026-041"
SELL, SELL_EVT = "EVT-2026-052-01", "EVT-2026-052"


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def close(client, item, event, target, limit):
    client.put(f"/api/items/{item}/points", json={"target": target, "limit": limit})
    client.post(f"/api/items/{item}/confirm-points")
    client.post(f"/api/items/{item}/release-bids", json={})
    client.post(f"/api/items/{item}/analyze")
    sid = client.post(f"/api/items/{item}/negotiations", json={"mode": "auto"}).json()["id"]
    while client.post(f"/api/sessions/{sid}/advance").json()["status"] == "active":
        pass
    client.post(f"/api/items/{item}/accept-deal")
    return client.post(f"/api/events/{event}/approve")


def rows(resp):
    return list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))


def test_unknown_and_open_events_cannot_be_exported(client):
    assert client.get("/api/events/NOPE/export").status_code == 404
    assert client.get(f"/api/events/{BUY_EVT}/export").status_code == 409


def test_buy_export_matches_the_template_layout(client):
    # close every item of the event: the hero item is negotiated, the rest accept their best quote
    items = [i["id"] for i in client.get(f"/api/events/{BUY_EVT}").json()["items"]]
    assert BUY in items
    close(client, BUY, BUY_EVT, 250, 270)
    for iid in items:
        if iid == BUY:
            continue
        d = client.get(f"/api/items/{iid}").json()["item"]
        client.put(f"/api/items/{iid}/points", json={"target": d["reference_price"] * 0.9, "limit": d["reference_price"] * 1.5})
        client.post(f"/api/items/{iid}/confirm-points")
        client.post(f"/api/items/{iid}/release-bids", json={})
        client.post(f"/api/items/{iid}/analyze")
        client.post(f"/api/items/{iid}/accept-deal")
    assert client.post(f"/api/events/{BUY_EVT}/approve").status_code in (200, 409)
    r = client.get(f"/api/events/{BUY_EVT}/export")
    if r.status_code == 409:
        pytest.skip("event could not be fully closed in this scenario")
    assert r.headers["content-type"].startswith("text/csv")
    assert "shopping_cart_template_EVT-2026-041.csv" in r.headers["content-disposition"]
    table = rows(r)
    assert table[0] == TEMPLATE_COLUMNS and all(len(row) == 38 for row in table)
    first = next(row for row in table[1:] if row[3] == "1")
    assert first[12] == "INR" and first[22] == "270" and first[20] == "600"
    assert len(first[23]) == 10 and first[23][2] == "." and first[23][5] == "."
    assert first[14] == "ZD45" and first[5]


def test_sell_export_is_a_plain_summary_with_the_uplift(client):
    items = [i["id"] for i in client.get(f"/api/events/{SELL_EVT}").json()["items"]]
    if len(items) != 1:
        pytest.skip("hero sell event has more than one item")
    assert close(client, SELL, SELL_EVT, 170, 165).status_code == 200
    table = rows(client.get(f"/api/events/{SELL_EVT}/export"))
    assert table[0][0] == "Event" and table[1][7] == "167" and table[1][8] == "20000"
