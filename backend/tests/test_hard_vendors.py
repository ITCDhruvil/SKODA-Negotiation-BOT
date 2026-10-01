import json

import pytest
from fastapi.testclient import TestClient

from app import deal
from app.api import create_app
from app.models import Dataset
from app.negotiation import guardrails
from app.negotiation.personas import PROFILES
from app.store import Repo
from tests.test_negotiation_engine import play

BUY = "EVT-2026-041-01"


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def analyzed(client, item, target, limit):
    client.put(f"/api/items/{item}/points", json={"target": target, "limit": limit})
    client.post(f"/api/items/{item}/confirm-points")
    client.post(f"/api/items/{item}/release-bids", json={})
    assert client.post(f"/api/items/{item}/analyze").status_code == 200


def run_auto(client, item, vendor=None, cap=40):
    body = {"mode": "auto", **({"vendor_id": vendor} if vendor else {})}
    sid = client.post(f"/api/items/{item}/negotiations", json=body).json()["id"]
    s = {}
    for _ in range(cap):
        s = client.post(f"/api/sessions/{sid}/advance").json()
        if s["status"] != "active":
            break
    return s


# --- history says who is hard to crack ---------------------------------------------------------

def test_history_marks_the_known_hard_vendors_and_not_the_flexible_ones(client):
    tough = {v["id"]: v["toughness"] for v in client.get("/api/vendors").json()}
    assert all(tough[v]["level"] == "hard" for v in ("V008", "V037", "V024", "V003", "V042"))
    assert tough["V008"]["negotiated_deals"] >= 3 and tough["V008"]["average_concession_pct"] < 2.5
    assert "Hard to crack" in tough["V008"]["note"] and "negotiated deals" in tough["V008"]["note"]
    assert tough["V036"]["level"] in ("flexible", "firm") and tough["V001"]["level"] != "hard"
    unknown = [t for t in tough.values() if t["level"] == "unknown"]
    assert unknown and all(t["negotiated_deals"] < 3 for t in unknown)


def test_the_item_page_shows_each_invited_vendors_difficulty(client):
    inv = {i["vendor_id"]: i["toughness"]["level"] for i in client.get(f"/api/items/{BUY}").json()["invitees"]}
    assert inv["V008"] == "hard"


# --- every persona stays inside the buyer's limit ---------------------------------------------

@pytest.mark.parametrize("persona", list(PROFILES))
@pytest.mark.parametrize("direction,kw", [
    ("buy", dict(target=250, limit=270, quote=285)),
    ("sell", dict(target=170, limit=165, quote=163)),
])
@pytest.mark.parametrize("reserve_gap", [-3, 1, 4, 12])
def test_no_persona_ever_takes_us_past_the_limit_or_runs_forever(persona, direction, kw, reserve_gap):
    limit = kw["limit"]
    # buy: a reserve below the ceiling can be met, above it cannot; mirrored for sell
    reserve = limit + reserve_gap if direction == "buy" else limit + 4 - reserve_gap
    status, price, _, log = play(direction, reserve=reserve, flex=0.3, persona=persona, has_alternative=True, **kw)
    assert status in ("agreed", "handback")
    assert len(log) <= 2 * 13 + 1
    for who, _kind, p, _pay in log:
        if who == "us" and p is not None:
            assert deal.within_limit(direction, p, limit)
    if status == "agreed":
        assert deal.within_limit(direction, price, limit)
        # the vendor never sold below (or bought above) its own reserve
        assert price >= reserve if direction == "buy" else price <= reserve


def test_a_vendor_that_calls_a_price_final_early_is_tested_once():
    status, price, _, log = play("buy", target=250, limit=280, quote=292, reserve=274, flex=0.3,
                                 persona="bluffer", has_alternative=True)
    assert status == "agreed" and 274 <= price <= 280
    assert any(k == "firm" for w, k, *_ in log if w == "vendor")


def test_conversations_with_a_firm_vendor_are_long_but_bounded():
    kw = dict(target=250, limit=280, quote=292, reserve=274, flex=0.3, has_alternative=True)
    lengths = {p: len(play("buy", persona=p, **kw)[3]) for p in PROFILES}
    assert max(lengths.values()) >= 14 and max(lengths.values()) <= 27  # long, but never endless


# --- the hard-vendor demo conversation end to end ----------------------------------------------

def test_the_hard_vendor_story_takes_many_rounds_uses_tactics_and_still_closes(client):
    analyzed(client, BUY, 250, 280)
    s = run_auto(client, BUY, vendor="V008")
    assert s["status"] == "agreed" and 274 <= s["agreed_price"] <= 280
    assert len(s["turns"]) >= 14
    tactics_used = {t["tactic"] for t in s["turns"] if t["speaker"] == "us"}
    assert {"open", "concede", "bluff"} <= tactics_used
    assert s["strategy"]["history"]["level"] == "hard" and s["strategy"]["round"] == s["round"]
    assert s["strategy"]["phase"] == "done" and s["strategy"]["max_rounds"] == 12


def test_a_vendor_beyond_the_limit_is_handed_back_with_options(client):
    analyzed(client, BUY, 250, 270)
    s = run_auto(client, BUY, vendor="V008")
    assert s["status"] == "handed_back"
    assert "Options:" in s["handback_reason"] and "switch to the next-best quote" in s["handback_reason"]
    assert s["strategy"]["alternative"] and "Sahyadri" in s["strategy"]["alternative"]


def test_nothing_secret_or_false_appears_in_a_hard_conversation(client, repo):
    analyzed(client, BUY, 250, 280)
    sid = client.post(f"/api/items/{BUY}/negotiations", json={"mode": "auto", "vendor_id": "V008"}).json()["id"]
    texts = []
    for _ in range(30):
        r = client.post(f"/api/sessions/{sid}/advance")
        texts.append(r.text)
        if r.json()["status"] != "active":
            break
    s = repo.get("session", sid)
    reserve = repo.get("reserve", s.bid_id)
    blob = "\n".join(texts).lower()
    assert "reserve" not in blob and "persona" not in blob and "bluffer" not in blob
    for t in json.loads(texts[-1])["turns"]:
        if t["speaker"] == "us":
            guardrails.check_message(t["text"], offer_price=t["price"], limit=280, target=250)
            assert "other offers" not in t["text"].lower() or t["tactic"] == "leverage"
    assert reserve == 274


def test_the_same_conversation_is_produced_every_time(seed_dataset):
    def transcript():
        r = Repo()
        r.load_dataset(seed_dataset)
        c = TestClient(create_app(r, seed_dataset))
        analyzed(c, BUY, 250, 280)
        return [(t["speaker"], t["price"], t["text"]) for t in run_auto(c, BUY, vendor="V008")["turns"]]
    assert transcript() == transcript()


def test_every_analysed_item_ends_cleanly_whatever_the_vendor_is_like(client, repo):
    n = 0
    for item in repo.fetch("item"):
        if item.state != "analyzed":
            continue
        s = run_auto(client, item.id)
        assert s["status"] in ("agreed", "handed_back") and s["round"] <= 12
        n += 1
    assert n >= 20


def test_a_vendor_that_goes_to_check_replies_hours_or_days_later(client):
    analyzed(client, BUY, 250, 280)
    s = run_auto(client, BUY, vendor="V008")
    turns = s["turns"]
    elapsed = [t["elapsed_minutes"] for t in turns]
    assert elapsed == sorted(elapsed) and elapsed[0] == 0 and turns[0]["delay_minutes"] == 0
    for a, b in zip(turns, turns[1:]):
        assert b["elapsed_minutes"] - a["elapsed_minutes"] == b["delay_minutes"]
    pauses = [i for i, t in enumerate(turns) if t["speaker"] == "vendor" and t["price"] is None]
    assert pauses
    for i in pauses:
        assert turns[i]["delay_minutes"] < 30            # saying "let me check" is quick
        assert turns[i + 1]["delay_minutes"] >= 60       # the answer takes hours or days
    quick = [t["delay_minutes"] for i, t in enumerate(turns) if t["speaker"] == "vendor" and t["price"] is not None and i - 1 not in pauses and i > 0]
    assert quick and max(quick) <= 40
    assert s["strategy"]["elapsed_minutes"] == turns[-1]["elapsed_minutes"] > 0
