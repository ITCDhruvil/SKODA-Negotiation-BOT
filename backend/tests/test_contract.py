from fastapi.testclient import TestClient

from app.api import create_app


def _closed_events(c):
    return [e for e in c.get("/api/events").json() if e["status"] == "closed"]


def test_a_closed_purchase_has_a_purchase_order_with_the_agreed_figures(repo, seed_dataset):
    c = TestClient(create_app(repo, seed_dataset))
    buy = next(e for e in _closed_events(c) if e["direction"] == "buy")
    docs = c.get(f"/api/events/{buy['id']}/contract").json()
    assert docs and docs[0]["contract_type"] in ("Purchase Order (PO)", "Frame Contract (FC)")
    d = docs[0]
    assert d["contract_no"].startswith("CT-E1-") and d["request_no"] == buy["id"]
    assert abs(sum(i["value"] for i in d["items"]) - d["total_value"]) < 0.01
    assert d["buyer_name"] == "SKODA Auto VW India" and d["approvals"][0]["role"] == "Section Head BA"


def test_a_closed_scrap_sale_has_a_scrap_contract_with_the_company_as_seller(repo, seed_dataset):
    c = TestClient(create_app(repo, seed_dataset))
    sale = next(e for e in _closed_events(c) if e["direction"] == "sell")
    d = c.get(f"/api/events/{sale['id']}/contract").json()[0]
    assert d["contract_type"] == "Scrap contract" and d["seller_name"] == "SKODA Auto VW India"
    assert d["saved"] >= 0


def test_the_approval_chain_grows_with_the_value():
    from app.contract import _approvers

    assert [r for r, _ in _approvers(4_000_000, False)] == ["Section Head BA"]
    assert [r for r, _ in _approvers(8_000_000, False)] == ["Section Head BA", "Head BA"]
    assert [r for r, _ in _approvers(20_000_000, False)] == ["Section Head BA", "Head BA", "ED Procurement", "Managing Director"]
    assert [r for r, _ in _approvers(20_000_000, True)] == ["Section Head BA", "Head BA", "ED Procurement"]  # scrap: ED only


def test_an_event_with_no_closed_deal_has_no_contract(repo, seed_dataset):
    c = TestClient(create_app(repo, seed_dataset))
    open_event = next(e for e in c.get("/api/events").json() if e["status"] != "closed")
    assert c.get(f"/api/events/{open_event['id']}/contract").status_code == 404
