import pytest
from fastapi.testclient import TestClient

from app import deal
from app.api import create_app
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_deal_result_is_better_when_we_pay_less_or_get_more():
    amount, share, decision = deal.deal_result("buy", 100, 95, 10)
    assert (amount, decision) == (50, "gain") and round(share, 3) == 0.05
    assert deal.deal_result("buy", 100, 105, 10)[2] == "loss"
    assert deal.deal_result("sell", 100, 105, 10) == (50, 0.05, "gain")
    assert deal.deal_result("sell", 100, 99.5, 10)[2] == "even"
    assert deal.net_result([50, -20.5]) == 29.5 and deal.average([10, 20]) == 15


def test_every_vendor_has_at_least_four_past_deals(client):
    for v in client.get("/api/vendors").json():
        detail = client.get(f"/api/vendors/{v['id']}").json()
        assert len(detail["history"]) >= 4, v["id"]


def test_each_past_deal_carries_its_benchmark_result_and_decision(client):
    d = client.get("/api/vendors/V008").json()
    s = d["history_summary"]
    assert s["deals"] == len(d["history"]) and s["gains"] + s["evens"] + s["losses"] <= s["deals"]
    judged = [p for p in d["history"] if p["decision"]]
    assert judged and abs(s["net_result"] - round(sum(p["result"] for p in judged), 2)) < 0.01
    neg = next(p for p in d["history"] if p["negotiated"])
    assert neg["basis"] == "the original quote" and neg["benchmark"] == neg["original_price"]
    assert neg["value"] == round(neg["unit_price"] * neg["qty"], 2)


def test_a_past_deal_page_explains_the_result_and_lists_similar_deals(client):
    first = client.get("/api/vendors/V008").json()["history"][0]
    r = client.get(f"/api/history/{first['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["deal"]["id"] == first["id"] and body["explanation"]
    assert all(x["description"] == first["description"] and x["id"] != first["id"] for x in body["similar"])
    assert client.get("/api/history/NOPE").status_code == 404
