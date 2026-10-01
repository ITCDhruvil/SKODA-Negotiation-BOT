"""Fixes from the whole-phase review: outgoing-text rules, closing without a deal, the best quote,
continuing past an agreed result, and the extra workspace API."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import clock, deal, readmodel, services
from app.api import create_app
from app.models import Dataset
from app.negotiation import guardrails, messages, tactics
from app.negotiation import service as neg
from app.negotiation import views as negviews
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


def analyzed(repo: Repo, item_id: str, target: float, limit: float) -> None:
    services.set_points(repo, item_id, target=target, limit=limit, objective="reduce_price")
    services.confirm_points(repo, item_id)
    services.release_bids(repo, item_id)
    services.analyze(repo, item_id)


def run_auto(repo: Repo, session_id: str, max_steps: int = 12):
    for _ in range(max_steps):
        s = neg.advance(repo, session_id)
        if s.status != "active":
            return s
    raise AssertionError("auto negotiation did not finish")


@pytest.fixture
def buy(repo: Repo) -> Repo:
    analyzed(repo, BUY, 250, 270)
    return repo


@pytest.fixture
def sell(repo: Repo) -> Repo:
    analyzed(repo, SELL, 170, 165)
    return repo


def check(text, **kw):
    kw.setdefault("offer_price", 260)
    kw.setdefault("limit", 270)
    kw.setdefault("target", 250)
    guardrails.check_message(text, **kw)


# --- A1 numbers must match the offer ---------------------------------------------------------

def test_a_manual_text_naming_another_price_is_refused(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(services.Conflict) as e:
        neg.send_message(buy, s.id, price=260, text="Fine, we accept 290 per meal.")
    assert "290" in str(e.value) and "260" in str(e.value)
    assert neg.turns(buy, s.id) == []
    # the offer, the quantity, the vendor's own quote and a payment period may all be named
    neg.send_message(buy, s.id, price=260, payment_code="ZD45",
                     text="For 600 meals, you quoted 285; can you do 260 with 45 days payment?")


def test_check_message_allowed_numbers():
    check("We can do 260 for 600 units.", allowed_numbers=[600])
    with pytest.raises(guardrails.GuardrailError, match="names 290 but the offer is 260"):
        check("We accept 290.", allowed_numbers=[600])
    with pytest.raises(guardrails.GuardrailError):
        check("We can do 260 for 700 units.", allowed_numbers=[600])
    check("Anything 999 goes", allowed_numbers=None)  # not enforced unless the caller gives numbers
    with pytest.raises(guardrails.GuardrailError):  # internal numbers stay forbidden even if "allowed"
        check("We can do 270.", allowed_numbers=[270])


@pytest.mark.parametrize("lang", messages.LANGS)
@pytest.mark.parametrize("direction", ["buy", "sell"])
@pytest.mark.parametrize("kind", ["open", "counter", "close", "accept"])
@pytest.mark.parametrize("qty,unit", [(5000, "KG"), (1, "EA"), (1234567.5, "TON"), (600, "AU")])
def test_every_template_passes_with_the_numbers_the_service_allows(lang, direction, kind, qty, unit):
    name, item = "Konkan Enterprises LLP", "Aluminium Turnings 6mm"
    price, quote = 168.0, 163.0
    text = messages.our_message(kind, direction=direction, lang=lang, vendor_name=name, item=item,
                                qty=qty, unit=unit, quote=quote, price=price, payment_ask="ZD15",
                                agreed_payment="ZD30")
    allowed = [qty, price, quote, 15, 30] + guardrails.numbers_in(item)
    guardrails.check_message(text, offer_price=price, limit=165, target=170, allowed_numbers=allowed,
                             mask=(name, messages.short_name(name), item))


# --- A2 close without deal -------------------------------------------------------------------

def _closed_summary_consistent(snap_ev):
    assert snap_ev.status == "closed"
    if snap_ev.direction == "buy":
        assert round(snap_ev.original_value - snap_ev.final_value, 2) == snap_ev.realised_delta
    else:
        assert round(snap_ev.final_value - snap_ev.original_value, 2) == snap_ev.realised_delta


def test_closing_a_sell_no_deal_event_without_a_deal(repo: Repo):
    ev = next(e for e in repo.fetch("event") if e.no_deal and e.direction == "sell")
    (item,) = repo.fetch("item", parent=ev.id)
    before = readmodel.dashboard(readmodel.snapshot(repo)).kpis
    out = neg.close_without_deal(repo, item.id)
    assert out.state == "closed" and repo.get("outcome", item.id) is None
    snap = readmodel.snapshot(repo)
    iv = readmodel.item_view(snap, snap.item_by_id[item.id])
    assert (iv.value, iv.gap, iv.potential_delta, iv.recommendation) == (0.0, 0.0, 0.0, "done")
    evv = readmodel.event_view(snap, snap.event_by_id[ev.id])
    assert evv.status == "closed" and evv.quoted_value == 0 == evv.final_value == evv.original_value
    assert evv.items_negotiated == 0 and evv.realised_delta == 0
    _closed_summary_consistent(evv)
    after = readmodel.dashboard(snap).kpis
    assert after.completed_negotiations == before.completed_negotiations
    assert after.total_value == round(sum(e.quoted_value for e in snap_events(snap)), 2)


def snap_events(snap):
    ivs = {i.id: readmodel.item_view(snap, i) for i in snap.items}
    return [readmodel.event_view(snap, e, ivs) for e in snap.events]


def test_a_buy_event_mixing_a_deal_and_a_no_deal_still_adds_up(repo: Repo):
    ev = next(e for e in repo.fetch("event") if e.no_deal and e.direction == "buy")
    items = repo.fetch("item", parent=ev.id)
    neg.close_without_deal(repo, items[0].id)
    for other in items[1:]:
        neg.accept_deal(repo, other.id)
    neg.approve_event(repo, ev.id)
    snap = readmodel.snapshot(repo)
    evv = readmodel.event_view(snap, snap.event_by_id[ev.id])
    _closed_summary_consistent(evv)
    assert evv.final_value > 0 and evv.items_negotiated == 0


def test_only_a_handed_back_item_can_close_without_a_deal(buy: Repo):
    with pytest.raises(services.Conflict):
        neg.close_without_deal(buy, BUY)            # analyzed
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(services.Conflict):
        neg.close_without_deal(buy, BUY)            # negotiating
    neg.hand_back(buy, s.id)
    assert neg.close_without_deal(buy, BUY).state == "closed"
    with pytest.raises(services.Conflict):
        neg.close_without_deal(buy, BUY)            # already closed
    with pytest.raises(services.NotFound):
        neg.close_without_deal(buy, "NOPE")


# --- A3 one definition of the best quote -----------------------------------------------------

def test_the_default_vendor_is_the_vendor_of_the_best_raw_quote(repo: Repo):
    checked = 0
    for item in repo.fetch("item"):
        if item.state != "analyzed":
            continue
        snap = readmodel.snapshot(repo)
        iv = readmodel.item_view(snap, item)
        s = neg.start(repo, item.id, mode="manual")
        assert s.vendor_id == iv.best_bid_vendor_id and s.original_price == iv.best_bid
        checked += 1
    assert checked >= 20


# --- A4 continue must push further -----------------------------------------------------------

def test_continue_on_the_buy_hero_asks_for_less_and_lands_on_268(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    assert s.agreed_price == 270
    s = neg.continue_negotiation(buy, BUY)
    assert s.continuing and s.status == "active"
    s = neg.advance(buy, s.id)
    ts = neg.turns(buy, s.id)
    ask = ts[-2]
    assert ask.speaker == "us" and ask.price < 270 and not s.continuing
    assert s.status == "active" and s.vendor_offer == 268 and s.vendor_final
    s = neg.advance(buy, s.id)
    assert s.status == "agreed" and s.agreed_price == 268
    assert deal.realised_delta("buy", s.original_price, s.agreed_price, 600) == 10200


def test_continue_on_the_sell_hero_lands_on_169(sell: Repo):
    s = run_auto(sell, neg.start(sell, SELL, mode="auto").id)
    assert s.agreed_price == 168
    s = neg.continue_negotiation(sell, SELL)
    s = run_auto(sell, s.id)
    assert s.agreed_price == 169
    assert deal.realised_delta("sell", s.original_price, s.agreed_price, 5000) == 30000


def test_continue_in_approve_mode_drafts_a_better_ask_not_the_same_accept(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    neg.continue_negotiation(buy, BUY)
    neg.set_mode(buy, s.id, "approve")
    s = neg.advance(buy, s.id)
    d = neg.pending_draft(buy, s.id)
    assert d.kind == "offer" and d.price < 270 and "keep going" in d.rationale


def test_continue_accepts_when_nothing_better_can_be_asked():
    base = dict(direction="buy", target=250, limit=270, objective=None, round=2, our_offer=250,
                previous_vendor_offer=255, vendor_payment="ZD30", vendor_final=True,
                original_price=285, continuing=True)
    at_target = tactics.respond(tactics.Context(vendor_offer=250, **base))
    assert at_target.kind == "accept" and at_target.price == 250
    barely = tactics.respond(tactics.Context(vendor_offer=251, **base))
    assert barely.kind == "accept"     # a move that rounds to the vendor's own price is not a move
    push = tactics.respond(tactics.Context(vendor_offer=260, **base))
    assert push.kind == "offer" and push.message_kind == "counter" and push.price < 260


# --- B1 B2 B3 banned words --------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "I am an A.I. helping", "An A.I writes this", "this is AI", "our bots", "an automating tool",
    "powered by software", "a robot wrote it", "ChatGPT said", "chat gpt", "written by Claude",
    "OpenAI", "Copilot drafted", "auto-generated reply", "computer generated", "a virtual agent",
    "a program", "my script", "I am not a real person", "we are automating", "assistants",
    "he is machine", "बॉट है", "यह एआई है", "ए.आई. से", "कृत्रिम बुद्धिमत्ता", "मशीन से लिखा",
    "सॉफ्टवेयर", "स्वचालित संदेश", "सॉफ़्टवेयर"])
def test_more_ways_of_saying_it_is_software_are_blocked(text):
    with pytest.raises(guardrails.GuardrailError):
        check(text)


@pytest.mark.parametrize("text", [
    "the highest we can go", "lowest we can go", "that is our bottom line", "rock bottom",
    "our limits", "targets matter", "floors", "सीमा तय है", "लिमिट", "लक्ष्य", "टार्गेट", "टारगेट",
    "बजट", "अधिकतम", "न्यूनतम", "रिज़र्व", "रिजर्व", "मर्यादा", "उद्दिष्ट", "कमाल"])
def test_more_ways_of_naming_an_internal_position_are_blocked(text):
    with pytest.raises(guardrails.GuardrailError):
        check(text)


def test_ordinary_words_are_not_caught_by_the_stems():
    check("Thanks, the paid amount is fine and the bottom of the page is blank.")
    check("Please confirm the tail-end details and maintain the quality.")


def test_tricks_with_width_and_invisible_characters_are_blocked():
    with pytest.raises(guardrails.GuardrailError):
        check("this is ＡＩ")
    with pytest.raises(guardrails.GuardrailError):
        check("this is A​I")
    with pytest.raises(guardrails.GuardrailError):
        check("ए‍आई")
    with pytest.raises(guardrails.GuardrailError):
        check("our ceil­in​g is firm")


def test_devanagari_with_joiners_still_passes():
    check("आपके जवाब के लिए धन्यवाद‍। हम 260 प्रति नग तक आ सकते हैं‌।")


def test_a_vendor_name_or_item_with_a_banned_word_is_allowed_but_not_typed_freely():
    mask = ("Machine Tools Pvt Ltd", "Floor cleaning service")
    check("Hello Machine Tools Pvt Ltd, for Floor cleaning service we can do 260.", mask=mask)
    with pytest.raises(guardrails.GuardrailError):
        check("Hello Machine Tools Pvt Ltd, our machine says 260.", mask=mask)
    with pytest.raises(guardrails.GuardrailError):
        check("Hello Machine Tools Pvt Ltd, our floor is 260.", mask=mask)
    with pytest.raises(guardrails.GuardrailError):  # masked text is still read for numbers
        check("Hello Machine Tools 250 Ltd", mask=("Machine Tools 250 Ltd",))


def test_the_service_masks_the_vendor_name_and_item_description(buy: Repo):
    item = buy.get("item", BUY)
    buy.put("item", item.id, item.model_copy(update={"description": "Floor cleaning of Machine hall"}),
            parent=item.event_id)
    s = neg.start(buy, BUY, mode="manual")
    s = neg.send_message(buy, s.id, price=260)       # the generated text names the description
    assert "Floor cleaning of Machine hall" in neg.turns(buy, s.id)[0].text
    with pytest.raises(services.Conflict):
        neg.send_message(buy, s.id, price=262, text="Our floor is open to 262 for you.")


# --- B4 B5 B6 B7 service rules ---------------------------------------------------------------

def test_an_offer_must_beat_the_vendors_current_price(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(services.Conflict):       # equal to the vendor's own quote
        neg.send_message(buy, s.id, price=285)
    s = buy.get("session", s.id)
    s = s.model_copy(update={"vendor_offer": 265.0, "our_offer": 255.0, "round": 1})
    buy.put("session", s.id, s, parent=s.item_id)
    for same_or_worse in (265, 266):
        with pytest.raises(services.Conflict, match="accept it instead"):
            neg.send_message(buy, s.id, price=same_or_worse)
    assert neg.send_message(buy, s.id, price=264).round == 2


def test_deal_is_better():
    assert deal.is_better("buy", 5, 6) and not deal.is_better("buy", 6, 6)
    assert deal.is_better("sell", 7, 6) and not deal.is_better("sell", 6, 6)


def test_blank_text_means_auto_wording(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    s = neg.send_message(buy, s.id, price=255, text="   \n ")
    assert neg.turns(buy, s.id)[0].text.startswith("Hello")


def test_an_unedited_approval_keeps_the_bot_as_author_even_with_blank_text(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    d = neg.pending_draft(buy, s.id)
    s = neg.approve_draft(buy, s.id, d.id, text="  ", price=d.price, payment_code=d.payment_code)
    assert neg.turns(buy, s.id)[0].author == "bot"


def test_accept_and_hand_back_drafts_cannot_be_edited(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.discard_draft(buy, s.id, neg.pending_draft(buy, s.id).id)
    s = s.model_copy(update={"vendor_offer": 268.0, "our_offer": 250.0, "round": 2,
                             "vendor_final": True})
    buy.put("session", s.id, s, parent=s.item_id)
    neg.advance(buy, s.id)
    accept = neg.pending_draft(buy, s.id)
    assert accept.kind == "accept"
    for edit in (dict(price=269), dict(payment_code="ZD60"), dict(text="Okay, thanks")):
        with pytest.raises(services.Conflict, match="cannot be edited"):
            neg.approve_draft(buy, s.id, accept.id, **edit)
    assert neg.pending_draft(buy, s.id).id == accept.id
    s = neg.approve_draft(buy, s.id, accept.id)
    assert s.status == "agreed" and neg.turns(buy, s.id)[-1].author == "bot"


def test_a_hand_back_draft_cannot_be_edited(repo: Repo):
    ev = next(e for e in repo.fetch("event") if e.no_deal and e.direction == "sell")
    (item,) = repo.fetch("item", parent=ev.id)
    services.set_points(repo, item.id, target=item.suggested_target, limit=item.suggested_limit)
    s = neg.start(repo, item.id, mode="approve")
    for _ in range(12):
        d = neg.pending_draft(repo, s.id)
        if d is None:
            s = neg.advance(repo, s.id)
            continue
        if d.kind == "handback":
            with pytest.raises(services.Conflict, match="cannot be edited"):
                neg.approve_draft(repo, s.id, d.id, text="We are leaving")
            s = neg.approve_draft(repo, s.id, d.id)
            assert s.status == "handed_back"
            return
        s = neg.approve_draft(repo, s.id, d.id)
        assert s.status == "active"
    raise AssertionError("never reached a hand-back draft")


def test_moves_need_a_negotiating_item(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    item = buy.get("item", BUY)
    buy.put("item", item.id, item.model_copy(update={"state": "awaiting_approval"}), parent=item.event_id)
    with pytest.raises(services.Conflict):
        neg.send_message(buy, s.id, price=255)
    with pytest.raises(services.Conflict):
        neg.accept_offer(buy, s.id)


def test_discarding_needs_an_active_session_and_manual_mode_drops_the_draft(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    d = neg.pending_draft(buy, s.id)
    neg.set_mode(buy, s.id, "manual")
    assert neg.pending_draft(buy, s.id) is None
    s = neg.hand_back(buy, s.id)
    with pytest.raises(services.Conflict):
        neg.discard_draft(buy, s.id, d.id)


# --- C1 helpers ------------------------------------------------------------------------------

def test_deal_wording_and_gap_helpers():
    assert deal.limit_word("buy") == "ceiling" and deal.limit_word("sell") == "floor"
    assert deal.relative_gap(110, 100) == pytest.approx(0.1)
    assert deal.within_pct(102, 100, 0.025) and not deal.within_pct(103, 100, 0.025)
    assert deal.distance(3, 5) == 2
    with pytest.raises(ValueError):
        deal.limit_word("hold")


# --- C2 wording ------------------------------------------------------------------------------

def test_money_edges():
    assert messages.money(46.996) == "₹47"
    assert messages.money(46.1) == "₹46.10"
    assert messages.money(46.004) == "₹46"
    assert messages.money(-1.5) == "-₹1.50"
    assert messages.money(-1234567) == "-₹12,34,567"
    assert messages.money(0) == "₹0"
    assert messages.money(1234.999) == "₹1,235"


def test_english_units_pluralise_and_quantities_group_the_indian_way():
    kw = dict(direction="buy", lang="en", vendor_name="Acme Co", item="Bolts", unit="EA", quote=10,
              price=9, signature="X")
    assert "for 600 units of" in messages.our_message("open", qty=600, **kw)
    assert "for 1 unit of" in messages.our_message("open", qty=1, **kw)
    assert "for 12,345.50 units of" in messages.our_message("open", qty=12345.5, **kw)
    assert "5,000 lots" in messages.our_message("open", qty=5000, **{**kw, "unit": "AU"})
    assert "5,000 kg of" in messages.our_message("open", qty=5000, **{**kw, "unit": "KG"})
    assert "per unit" in messages.our_message("open", qty=600, **kw)


def test_greeting_drops_honorifics_and_copes_with_an_empty_name():
    kw = dict(direction="buy", lang="en", item="Bolts", qty=1, unit="EA", quote=10, price=9)
    assert messages.our_message("open", vendor_name="M/s Kumar Traders", **kw).startswith("Hello Kumar team")
    assert messages.our_message("open", vendor_name="The Shree Mr Patel Co", **kw).startswith("Hello Patel team")
    assert messages.our_message("open", vendor_name="", **kw).startswith("Hello team,")
    assert messages.our_message("open", vendor_name="Sri", **kw).startswith("Hello team,")
    hi = messages.our_message("open", **{**kw, "lang": "hi"}, vendor_name="")
    assert hi.startswith("नमस्कार टीम,")


def test_hindi_and_marathi_sign_offs_after_thanks_and_marathi_phrasing():
    kw = dict(direction="buy", item="Bolts", qty=1, unit="EA", quote=10, price=9, vendor_name="Acme")
    assert "\n\nसादर,\n" in messages.our_message("accept", lang="hi", **kw)
    assert "\n\nकळावे,\n" in messages.our_message("accept", lang="mr", **kw)
    assert "या दरापर्यंत" in messages.our_message("counter", lang="mr", **kw)
    assert "ऑर्डर आजच निश्चित करू शकतो" in messages.our_message("close", lang="mr", **kw)
    assert "प्रतिसादाबद्दल" in messages.vendor_message("counter", direction="buy", lang="mr",
                                                         price=9, unit="EA")


# --- C3 signature ----------------------------------------------------------------------------

def test_signature_comes_from_configuration(monkeypatch):
    monkeypatch.delenv("NEGOTIATION_SIGNATURE", raising=False)
    assert messages.signature() == "Dhruvil Patel\nSKODA Auto VW India, Pune"
    monkeypatch.setenv("NEGOTIATION_SIGNATURE", "Asha Rao\\nProcurement, Pune")
    assert messages.signature() == "Asha Rao\nProcurement, Pune"
    kw = dict(direction="buy", lang="en", vendor_name="Acme", item="Bolts", qty=1, unit="EA",
              quote=10, price=9)
    text = messages.our_message("open", **kw)
    assert text.endswith("Asha Rao\nProcurement, Pune") and "Dhruvil" not in text
    assert messages.our_message("open", signature="Given", **kw).endswith("Given")
    monkeypatch.setenv("NEGOTIATION_SIGNATURE", "   ")
    assert messages.signature().startswith("Dhruvil Patel")


# --- C4 IST date -----------------------------------------------------------------------------

def test_today_is_the_indian_calendar_date(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 30, 20, 0, tzinfo=timezone.utc))
    assert clock.today().isoformat() == "2026-10-01"
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 30, 18, 29, tzinfo=timezone.utc))
    assert clock.today().isoformat() == "2026-09-30"


def test_approval_records_the_indian_date(buy: Repo, monkeypatch):
    neg.accept_deal(buy, BUY)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 30, 20, 0, tzinfo=timezone.utc))
    neg.approve_event(buy, "EVT-2026-041")
    assert buy.get("outcome", BUY).closed_date.isoformat() == "2026-10-01"


# --- D API additions -------------------------------------------------------------------------

@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_session_actions_and_event_id(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    v = negviews.session_view(buy, s.id)
    assert v.event_id == "EVT-2026-041"
    a = v.actions
    assert (a.can_advance, a.can_send, a.can_accept_offer, a.can_hand_back) == (True, True, False, True)
    assert (a.can_continue, a.can_accept_deal) == (False, False)
    s = neg.set_mode(buy, s.id, "manual")
    assert negviews.session_view(buy, s.id).actions.can_advance is False
    s = run_auto(buy, neg.set_mode(buy, s.id, "auto").id)
    a = negviews.session_view(buy, s.id).actions
    assert (a.can_advance, a.can_send, a.can_accept_offer, a.can_hand_back) == (False,) * 4
    assert (a.can_continue, a.can_accept_deal) == (True, True)


def test_can_accept_offer_follows_the_limit(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    s = neg.send_message(buy, s.id, price=268)
    assert s.status == "active" or s.status == "agreed"
    v = negviews.session_view(buy, s.id)
    assert v.actions.can_accept_offer == (s.status == "active"
                                          and deal.within_limit("buy", s.vendor_offer, 270))


def test_item_detail_reports_the_sessions_and_events_list_them(client, repo: Repo):
    analyzed(repo, BUY, 250, 270)
    d = client.get(f"/api/items/{BUY}").json()
    assert d["active_session_id"] is None and d["latest_session_status"] is None
    sid = client.post(f"/api/items/{BUY}/negotiations", json={"mode": "approve"}).json()["id"]
    d = client.get(f"/api/items/{BUY}").json()
    assert d["active_session_id"] == sid and d["latest_session_status"] == "active"
    client.post(f"/api/sessions/{sid}/hand-back")
    d = client.get(f"/api/items/{BUY}").json()
    assert d["active_session_id"] is None and d["latest_session_status"] == "handed_back"
    r = client.get("/api/events/EVT-2026-041/sessions")
    assert r.status_code == 200 and [x["id"] for x in r.json()] == [sid]
    assert client.get("/api/events/NOPE/sessions").status_code == 404


def test_close_without_deal_route(client, repo: Repo):
    ev = next(e for e in repo.fetch("event") if e.no_deal and e.direction == "sell")
    (item,) = repo.fetch("item", parent=ev.id)
    r = client.post(f"/api/items/{item.id}/close-without-deal")
    assert r.status_code == 200 and r.json()["item"]["state"] == "closed"
    assert r.json()["item"]["recommendation"] == "done" and r.json()["outcome"] is None
    assert client.post(f"/api/items/{item.id}/close-without-deal").status_code == 409
    assert client.post("/api/items/NOPE/close-without-deal").status_code == 404


def test_approve_mode_has_its_first_draft_ready_but_other_modes_do_not(buy: Repo):
    a = neg.start(buy, BUY, mode="approve")
    d = neg.pending_draft(buy, a.id)
    assert d is not None and d.kind == "offer"
    neg.advance(buy, a.id)
    assert len(buy.fetch("draft", parent=a.id)) == 1
    neg.hand_back(buy, a.id)
    services.set_points(buy, BUY, target=250, limit=270)
    for mode in ("auto", "manual"):
        b = neg.start(buy, BUY, mode=mode)
        assert neg.pending_draft(buy, b.id) is None
        neg.hand_back(buy, b.id)
        services.set_points(buy, BUY, target=250, limit=270)


def test_every_template_text_is_free_of_new_banned_words():
    for (kind, direction, lang), _ in messages._OURS.items():
        text = messages.our_message(kind, direction=direction, lang=lang, vendor_name="Acme",
                                    item="Bolts", qty=10, unit="EA", quote=11, price=10,
                                    payment_ask="ZD45", agreed_payment="ZD45")
        guardrails.check_message(text, offer_price=10, limit=12, target=9,
                                 allowed_numbers=[10, 11, 45])

