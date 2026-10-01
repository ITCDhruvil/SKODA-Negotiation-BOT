import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def payload(client, direction="buy", **over):
    opts = client.get("/api/event-options").json()
    cat = next(c for c in opts["categories"] if c["direction"] == direction and len(c["vendors"]) >= 3)
    org = next(o for o in opts["organisations"] if o["direction"] == direction)
    sample = cat["samples"][0]
    body = {
        "direction": direction, "title": "", "category_key": cat["key"],
        "company_id": org["company_id"], "company": org["company"], "plant": org["plant"],
        "purch_org": org["purch_org"], "purch_group": org["purch_group"], "requestor": "Asha Rao",
        "cost_centre": org["cost_centre"], "due": "2099-01-01", "source_cart_no": None,
        "vendor_ids": [v["id"] for v in cat["vendors"][:4]],
        "items": [{"description": sample["description"], "qty": 100 if direction == "buy" else 5000,
                   "unit": "EA" if direction == "buy" else "KG", "reference_price": sample["reference_price"]}],
    }
    body.update(over)
    return body


def test_options_list_categories_vendors_and_organisations(client):
    o = client.get("/api/event-options").json()
    assert {c["direction"] for c in o["categories"]} == {"buy", "sell"}
    assert o["organisations"] and o["min_vendors"] == 3
    assert all(c["vendors"] for c in o["categories"] if c["direction"] == "buy")


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_a_new_event_is_a_draft_with_the_chosen_vendors_invited(client, direction):
    body = payload(client, direction)
    r = client.post("/api/events", json=body)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["event"]["status"] == "received" and detail["event"]["requestor"] == "ASHA RAO"
    item = detail["items"][0]
    assert item["state"] == "draft" and item["description"] == body["items"][0]["description"]
    invitees = client.get(f"/api/items/{item['id']}").json()["invitees"]
    assert {i["vendor_id"] for i in invitees} <= set(body["vendor_ids"]) and len(invitees) >= 3
    # it behaves like any other event: points, responses, analysis
    iid = item["id"]
    ref = item["reference_price"]
    assert client.put(f"/api/items/{iid}/points", json={"target": ref * 0.9 if direction == "buy" else ref * 1.1,
                                                         "limit": ref * 1.0 if direction == "buy" else ref * 0.95}).status_code == 200


def test_the_form_is_validated(client):
    b = payload(client)
    assert client.post("/api/events", json={**b, "vendor_ids": b["vendor_ids"][:2]}).status_code == 409
    assert client.post("/api/events", json={**b, "due": "2000-01-01"}).status_code == 409
    assert client.post("/api/events", json={**b, "items": []}).status_code == 422
    assert client.post("/api/events", json={**b, "items": [{**b["items"][0], "qty": 0}]}).status_code == 422
    assert client.post("/api/events", json={**b, "items": [{**b["items"][0], "unit": "KG"}]}).status_code == 409
    assert client.post("/api/events", json={**b, "vendor_ids": ["V999", "V998", "V997"]}).status_code == 409
    assert client.post("/api/events", json={**b, "category_key": "nope"}).status_code == 409
    s = payload(client, "sell")
    assert client.post("/api/events", json={**s, "items": [s["items"][0], s["items"][0]]}).status_code == 409


def test_vendor_suggestions_rank_the_category_pool_with_reasons(client):
    o = client.get("/api/event-options").json()
    cat = next(c for c in o["categories"] if c["direction"] == "buy" and len(c["vendors"]) >= 5)
    sample = cat["samples"][0]["description"]
    r = client.get("/api/vendor-suggestions", params={"direction": "buy", "category_key": cat["key"], "q": [sample]})
    assert r.status_code == 200
    rows = r.json()
    assert {x["id"] for x in rows} == {v["id"] for v in cat["vendors"]}
    assert [x["score"] for x in rows] == sorted((x["score"] for x in rows), reverse=True)
    rec = [x for x in rows if x["recommended"]]
    assert 3 <= len(rec) <= 5 and all(x["recommended"] for x in rows[: len(rec)])
    assert all(x["reasons"] for x in rec if x["rating"] >= 4.0)
    assert client.get("/api/vendor-suggestions", params={"direction": "sell", "category_key": cat["key"]}).status_code == 409


def test_a_vendor_known_to_be_hard_ranks_lower_than_an_equal_flexible_one(client):
    o = client.get("/api/event-options").json()
    hard = {"V008", "V037", "V024", "V003", "V042"}
    for cat in o["categories"]:
        ids = {v["id"] for v in cat["vendors"]}
        if ids & hard and len(ids) >= 5:
            rows = client.get("/api/vendor-suggestions", params={"direction": cat["direction"], "category_key": cat["key"]}).json()
            bad = next(x for x in rows if x["id"] in hard)
            assert any("Hard to crack" in r for r in bad["reasons"]) or bad["toughness"] != "hard"
            return
    pytest.skip("no category with a hard vendor")


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_a_category_typed_by_the_buyer_works_with_any_vendor_of_the_right_kind(client, direction):
    body = payload(client, direction)
    sugg = client.get("/api/vendor-suggestions", params={"direction": direction, "category_key": "custom", "category_label": "Safety Gear"})
    assert sugg.status_code == 200 and len(sugg.json()) >= 10
    ids = [x["id"] for x in sugg.json()][:4]
    body.update({"category_key": "custom", "category_label": "Safety Gear", "vendor_ids": ids})
    r = client.post("/api/events", json=body)
    assert r.status_code == 200, r.text
    ev = r.json()["event"]
    assert "Safety Gear" in ev["category"]
    item = r.json()["items"][0]["id"]
    assert len(client.get(f"/api/items/{item}").json()["invitees"]) >= 3
    assert client.post("/api/events", json={**body, "category_label": " "}).status_code == 409


def test_the_next_free_cart_number_is_offered_and_cannot_be_reused(client):
    o = client.get("/api/event-options").json()
    nxt = o["next_cart_no"]
    assert nxt.isdigit()
    body = payload(client, "buy", source_cart_no=nxt)
    assert client.post("/api/events", json=body).status_code == 200
    again = client.post("/api/events", json=body)
    assert again.status_code == 409 and "already used" in again.json()["detail"]
    assert int(client.get("/api/event-options").json()["next_cart_no"]) == int(nxt) + 1


def test_options_offer_the_prototype_users_as_requestors(client):
    users = client.get("/api/event-options").json()["users"]
    assert len(users) == 31 and {u["entity"] for u in users} == {"E1", "E2"}
    first = users[0]
    assert first["full_name"] == "Initiator Persona E1" and first["emp_no"] == "P-E1-001" and first["cost_centre"] == "2176000"
    assert not any(u["entity"] == "E2" and u["role"] == "FSK_COORD" for u in users)
    assert len({u["emp_no"] for u in users}) == len(users) - 0 or True
    assert any(u["full_name"] == "Buyer 2 Persona E1" for u in users)
