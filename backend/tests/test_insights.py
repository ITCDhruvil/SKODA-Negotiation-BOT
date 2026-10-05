from app.models import Bid
from app.negotiation import insights


def bid(vid, price, pay="ZD30", inco="FH", days=14, warranty=0):
    return Bid(id=f"B-{vid}", item_id="I", vendor_id=vid, unit_price=price, payment_code=pay, incoterm=inco,
               delivery_days=days, validity_days=30, warranty_months=warranty)


def rnd(**kw):
    base = dict(direction="buy", vendor_name="Alpha", qty=10, original_price=110, original_payment="ZD30", price=105,
                previous_price=108, payment="ZD30", round_no=3, stalls=0, tokens=0, mood=0, flavour="", kind="counter",
                ended=False, final=False, target=95, limit=100, own_bid=bid("A", 110),
                others=[("Beta", bid("B", 104)), ("Gamma", bid("C", 120))], toughness_pct=None, toughness_deals=0,
                recent=())
    base.update(kw)
    return insights.Round(**base)


def kinds(**kw):
    return [n.kind for n in insights.pick(rnd(**kw))]


def test_a_price_inside_the_limit_is_flagged_with_what_accepting_would_give():
    n = insights.pick(rnd(price=99, previous_price=105))[0]
    assert n.kind == "checkpoint" and n.tone == "good"
    assert "within your limit" in n.text and "Savings" in n.text


def test_a_vendor_that_left_is_reported_with_the_next_best_quote():
    n = insights.pick(rnd(ended=True))[0]
    assert n.kind == "left" and "Beta" in n.text


def test_token_steps_and_impatience_are_called_out():
    assert kinds(tokens=2) == ["crawl"]
    assert kinds(mood=60) == ["mood"]
    assert "walking away" in insights.pick(rnd(mood=80))[0].text
    assert "final price" in insights.pick(rnd(flavour="ultimatum", kind="firm"))[0].text


def test_history_compares_what_has_moved_with_the_usual_movement():
    little = insights.pick(rnd(toughness_pct=8.0, toughness_deals=4))[0]
    assert little.kind == "history" and "some room is likely left" in little.text
    much = insights.pick(rnd(toughness_pct=1.0, toughness_deals=4))[0]
    assert "little left to gain" in much.text


def test_terms_note_appears_when_terms_change_which_offer_is_best():
    # Beta is cheaper on the face of it, but on advance payment Alpha's offer is worth more once terms are counted.
    n = insights.pick(rnd(price=106, payment="ZD60", own_bid=bid("A", 110, "ZD60"),
                          others=[("Beta", bid("B", 105, "ADV", days=60)), ("Gamma", bid("C", 120))]))
    assert n and n[0].kind in ("terms", "alternative")


def test_the_gap_to_the_next_best_quote_is_shown_for_a_vendor_that_is_behind():
    n = insights.pick(rnd(stalls=1))[0]
    assert n.kind == "alternative" and n.tone == "warn" and "switching" in n.text


def test_position_note_lists_the_other_quotes():
    n = insights.pick(rnd(price=118, previous_price=119, others=[("Beta", bid("B", 120))], recent=("alternative",)))
    assert n and n[0].kind == "position" and "Beta" in n[0].text


def test_the_same_kind_is_not_repeated_within_two_rounds():
    assert kinds(stalls=1, recent=("alternative",)) != ["alternative"]
    assert kinds(price=99, previous_price=105, recent=("checkpoint",)) == ["checkpoint"]  # a deal within reach is always said


def test_notes_never_name_a_limit_or_hidden_reserve():
    for kw in ({}, {"stalls": 1}, {"mood": 60}, {"tokens": 3}, {"price": 99, "previous_price": 105}):
        for n in insights.pick(rnd(**kw)):
            assert "reserve" not in n.text.lower()


def test_a_negotiation_attaches_notes_to_vendor_replies_and_never_to_our_messages(repo, seed_dataset):
    from fastapi.testclient import TestClient

    from app.api import create_app

    c = TestClient(create_app(repo, seed_dataset))
    item = "EVT-2026-041-01"
    c.put(f"/api/items/{item}/points", json={"target": 250, "limit": 270})
    c.post(f"/api/items/{item}/confirm-points")
    c.post(f"/api/items/{item}/release-bids", json={})
    c.post(f"/api/items/{item}/analyze")
    sid = c.post(f"/api/items/{item}/negotiations", json={"mode": "auto"}).json()["id"]
    s = {}
    for _ in range(14):
        s = c.post(f"/api/sessions/{sid}/advance").json()
        if s["status"] != "active":
            break
    mine = [t for t in s["turns"] if t["speaker"] == "us"]
    vendor = [t for t in s["turns"] if t["speaker"] == "vendor"]
    assert all(t["insights"] == [] for t in mine)
    assert sum(len(t["insights"]) for t in vendor) >= 3
    assert s["status"] == "agreed" and s["agreed_price"] == 270  # the hero deal is unchanged by the notes
    assert all(len(t["insights"]) <= 1 for t in vendor)
