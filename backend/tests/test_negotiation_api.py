import json

import pytest
from fastapi.testclient import TestClient

from app import services
from app.api import create_app
from app.models import Dataset
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def analyzed(client, item_id, target, limit):
    assert client.put(f"/api/items/{item_id}/points", json={"target": target, "limit": limit}).status_code == 200
    assert client.post(f"/api/items/{item_id}/confirm-points").status_code == 200
    assert client.post(f"/api/items/{item_id}/release-bids", json={}).status_code == 200
    assert client.post(f"/api/items/{item_id}/analyze").status_code == 200


def start(client, item_id, mode="approve", **extra):
    r = client.post(f"/api/items/{item_id}/negotiations", json={"mode": mode, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_start_needs_analysis_and_never_happens_by_itself(client):
    r = client.post(f"/api/items/{BUY}/negotiations", json={"mode": "auto"})
    assert r.status_code == 409
    analyzed(client, BUY, 250, 270)
    assert client.get(f"/api/items/{BUY}/sessions").json() == []
    s = start(client, BUY, "auto")
    assert s["status"] == "active" and s["round"] == 0 and s["turns"] == []
    assert [x["id"] for x in client.get(f"/api/items/{BUY}/sessions").json()] == [s["id"]]


def test_approve_mode_over_http_to_a_closed_item(client):
    analyzed(client, BUY, 250, 270)
    s = start(client, BUY, "approve")
    sid = s["id"]
    s = client.post(f"/api/sessions/{sid}/advance").json()
    d = s["pending_draft"]
    assert d["price"] == 250 and "target" in d["rationale"] and s["turns"] == []
    assert s["intelligence"]["recommendation"] == d["rationale"]

    s = client.post(f"/api/sessions/{sid}/drafts/{d['id']}/approve").json()   # no body at all
    assert [t["speaker"] for t in s["turns"]] == ["us", "vendor"]
    assert s["intelligence"]["latest_vendor_offer"] == 285 and s["intelligence"]["movement"] == 0

    for _ in range(10):
        s = client.post(f"/api/sessions/{sid}/advance").json()
        d = s["pending_draft"]
        s = client.post(f"/api/sessions/{sid}/drafts/{d['id']}/approve", json={}).json()
        if s["status"] != "active":
            break
    assert s["status"] == "agreed" and s["agreed_price"] == 270 and s["agreed_payment"] == "ZD45"
    assert s["agreed_delta"] == 9000 and s["intelligence"]["delta_if_accepted"] == 9000

    item = client.get(f"/api/items/{BUY}").json()
    assert item["item"]["state"] == "result_pending" and item["outcome"] is None

    r = client.post(f"/api/items/{BUY}/accept-deal")
    assert r.status_code == 200 and r.json()["item"]["state"] == "awaiting_approval"
    before = client.get("/api/dashboard").json()["kpis"]
    event = client.post("/api/events/EVT-2026-041/approve").json()
    assert next(i for i in event["items"] if i["id"] == BUY)["state"] == "closed"
    item = client.get(f"/api/items/{BUY}").json()
    assert item["outcome"]["final_price"] == 270 and item["outcome"]["value_delta"] == 9000
    after = client.get("/api/dashboard").json()["kpis"]
    assert after["completed_negotiations"] == before["completed_negotiations"] + 1
    assert after["realised_savings"] == round(before["realised_savings"] + 9000, 2)


def test_auto_mode_runs_by_repeated_advance_and_the_buyer_can_take_over(client):
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "auto")["id"]
    s = client.post(f"/api/sessions/{sid}/advance").json()
    assert s["round"] == 1 and s["status"] == "active"
    s = client.put(f"/api/sessions/{sid}/mode", json={"mode": "manual"}).json()
    assert s["mode"] == "manual"
    assert client.post(f"/api/sessions/{sid}/advance").json()["round"] == 1
    for _ in range(5):
        s = client.post(f"/api/sessions/{sid}/messages", json={"price": 270}).json()
        if s["status"] != "active":
            break
    assert s["status"] == "agreed" and [t["author"] for t in s["turns"]][2] == "human"


def test_full_auto_sell_hero_reaches_167(client):
    analyzed(client, SELL, 170, 165)
    sid = start(client, SELL, "auto")["id"]
    for _ in range(8):
        s = client.post(f"/api/sessions/{sid}/advance").json()
        if s["status"] != "active":
            break
    assert s["status"] == "agreed" and s["agreed_price"] == 167 and s["agreed_delta"] == 20000


def test_guardrails_reject_bad_manual_messages_with_a_readable_reason(client):
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "manual")["id"]
    r = client.post(f"/api/sessions/{sid}/messages", json={"price": 271})
    assert r.status_code == 409 and "ceiling" in r.json()["detail"]
    r = client.post(f"/api/sessions/{sid}/messages", json={"price": 260, "text": "I am an AI assistant"})
    assert r.status_code == 409 and "person" in r.json()["detail"]
    r = client.post(f"/api/sessions/{sid}/messages", json={"price": 260, "text": "our ceiling is firm"})
    assert r.status_code == 409
    assert client.get(f"/api/sessions/{sid}").json()["turns"] == []


@pytest.mark.parametrize("body", ['{"price": 0}', '{"price": -5}', '{"price": Infinity}', '{"price": NaN}',
                                  '{"price": "abc"}', '{}'])
def test_bad_message_bodies_are_422(client, body):
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "manual")["id"]
    r = client.post(f"/api/sessions/{sid}/messages", content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_hand_back_and_unknown_ids(client):
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "approve")["id"]
    client.post(f"/api/sessions/{sid}/advance")
    s = client.post(f"/api/sessions/{sid}/hand-back", json={"reason": "Taking this over."}).json()
    assert s["status"] == "handed_back" and s["handback_reason"] == "Taking this over."
    assert s["pending_draft"] is None
    assert client.get(f"/api/items/{BUY}").json()["item"]["state"] == "handed_back"
    assert client.post(f"/api/sessions/{sid}/messages", json={"price": 250}).status_code == 409
    assert client.get("/api/sessions/NOPE").status_code == 404
    assert client.get("/api/items/NOPE/sessions").status_code == 404
    assert client.post("/api/items/NOPE/negotiations", json={}).status_code == 404
    assert client.post("/api/events/NOPE/approve").status_code == 404
    assert client.put(f"/api/sessions/{sid}/mode", json={"mode": "robot"}).status_code == 422


def test_continue_and_accept_offer_and_approve_needs_something_waiting(client):
    analyzed(client, BUY, 250, 270)
    assert client.post("/api/events/EVT-2026-041/approve").status_code == 409
    sid = start(client, BUY, "auto")["id"]
    while client.post(f"/api/sessions/{sid}/advance").json()["status"] == "active":
        pass
    s = client.post(f"/api/items/{BUY}/continue").json()
    assert s["status"] == "active" and s["agreed_price"] is None
    s = client.post(f"/api/sessions/{sid}/accept-offer").json()
    assert s["status"] == "agreed" and s["agreed_price"] == 270


def test_accepting_the_best_quote_without_negotiating(client):
    analyzed(client, BUY, 250, 270)
    assert client.post(f"/api/items/{BUY}/accept-deal").json()["item"]["state"] == "awaiting_approval"
    client.post("/api/events/EVT-2026-041/approve")
    o = client.get(f"/api/items/{BUY}").json()["outcome"]
    assert (o["negotiated"], o["original_price"], o["final_price"]) == (False, 285, 285)


def test_the_vendors_hidden_reserve_never_appears_in_any_session_response(client, repo: Repo):
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "auto")["id"]
    texts = [client.post(f"/api/sessions/{sid}/advance").text for _ in range(4)]
    texts += [client.get(f"/api/sessions/{sid}").text, client.get(f"/api/items/{BUY}/sessions").text,
              client.get(f"/api/items/{BUY}").text]
    session = repo.get("session", sid)
    reserve = repo.get("reserve", session.bid_id)
    for text in texts:
        assert "reserve" not in text.lower()
        for turn in json.loads(text).get("turns", []) if text.startswith("{") else []:
            assert "flex" not in json.dumps(turn).lower()
    assert reserve == 268  # sanity: the hidden number is what we think it is, and it never shows up
    assert '"268' not in "".join(texts)


def test_nothing_the_vendor_sees_names_software_in_any_language(client, repo: Repo):
    """Sweep every analyzed seed item through the API in auto mode."""
    import re
    ai = re.compile(r"\b(ai|bot|assistant|automated|chatbot|llm|gpt)\b", re.IGNORECASE)
    n = 0
    for item in repo.fetch("item"):
        if item.state != "analyzed":
            continue
        sid = start(client, item.id, "auto")["id"]
        for _ in range(12):
            s = client.post(f"/api/sessions/{sid}/advance").json()
            if s["status"] != "active":
                break
        for t in s["turns"]:
            if t["speaker"] == "us":
                assert not ai.search(t["text"])
        n += 1
    assert n >= 20


def test_all_negotiations_lists_every_session_with_its_context(client):
    assert client.get("/api/negotiations").json() == []
    analyzed(client, BUY, 250, 270)
    sid = start(client, BUY, "approve")["id"]
    (row,) = client.get("/api/negotiations").json()
    assert row["id"] == sid and row["event_id"] == "EVT-2026-041" and row["direction"] == "buy"
    assert row["item_description"] and row["original_price"] == 285 and row["status"] == "active"
