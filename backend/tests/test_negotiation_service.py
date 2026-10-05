import pytest

from app import deal, lifecycle, readmodel, services
from app.negotiation import guardrails
from app.negotiation import service as neg
from app.store import Repo

BUY = "AIS-E1-2026-00077-01"
SELL = "AIS-E1-2026-00088-01"


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


def item_state(repo, item_id):
    return repo.get("item", item_id).state


# --- starting --------------------------------------------------------------------------------

def test_negotiation_only_starts_when_the_buyer_starts_it_after_analysis(repo: Repo):
    with pytest.raises(services.Conflict):
        neg.start(repo, BUY)  # still a draft
    analyzed(repo, BUY, 250, 270)
    assert neg.sessions_for_item(repo, BUY) == []  # analysing never starts anything by itself
    s = neg.start(repo, BUY, mode="approve")
    assert s.status == "active" and item_state(repo, BUY) == "negotiating"
    assert s.original_price == 285 and s.round == 0 and s.our_offer is None
    with pytest.raises(services.Conflict):
        neg.start(repo, BUY)  # already negotiating


def test_start_picks_the_vendor_of_the_best_quote_or_the_one_named(buy: Repo):
    s = neg.start(buy, BUY)
    snap = readmodel.snapshot(buy)
    view = readmodel.item_view(snap, buy.get("item", BUY))
    assert s.vendor_id == view.best_bid_vendor_id and s.original_price == view.best_bid


def test_start_rejects_a_vendor_that_did_not_quote(buy: Repo):
    with pytest.raises(services.Conflict):
        neg.start(buy, BUY, vendor_id="V999")


def test_a_seeded_negotiating_item_without_a_conversation_can_be_started(repo: Repo):
    seeded = next(i for i in repo.fetch("item") if i.state == "negotiating")
    s = neg.start(repo, seeded.id)
    assert s.status == "active" and item_state(repo, seeded.id) == "negotiating"


# --- full auto -------------------------------------------------------------------------------

def test_full_auto_hero_buy_ends_at_270_with_45_day_payment(buy: Repo):
    s = neg.start(buy, BUY, mode="auto")
    s = run_auto(buy, s.id)
    assert s.status == "agreed" and s.agreed_price == 270 and s.agreed_payment == "ZD45"
    assert item_state(buy, BUY) == "result_pending"
    ts = neg.turns(buy, s.id)
    # the vendor pauses once ("let me check with my team") before it moves, which is a message of its own
    assert [(t.speaker, t.price) for t in ts] == [
        ("us", 250), ("vendor", 285), ("us", 257), ("vendor", None), ("vendor", 280), ("us", 262), ("vendor", 277),
        ("us", 265), ("vendor", 275), ("us", 270), ("vendor", 270)]
    assert [t.author for t in ts] == ["bot", "vendor", "bot", "vendor", "vendor", "bot", "vendor", "bot", "vendor", "bot", "vendor"]
    assert deal.realised_delta("buy", s.original_price, s.agreed_price, 600) == 9000


def test_full_auto_hero_sell_ends_at_167(sell: Repo):
    s = run_auto(sell, neg.start(sell, SELL, mode="auto").id)
    assert s.status == "agreed" and s.agreed_price == 167
    assert deal.realised_delta("sell", s.original_price, s.agreed_price, 5000) == 20000


def test_nothing_the_vendor_sees_reveals_software_or_internal_numbers(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    for t in neg.turns(buy, s.id):
        if t.speaker == "us":
            guardrails.check_message(t.text, offer_price=t.price, limit=270, target=250)
            assert "Regards" not in t.text and "\n" not in t.text
            assert "$" not in t.text


# --- approve each message --------------------------------------------------------------------

def test_approve_mode_waits_for_the_buyer_and_lets_them_edit(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.advance(buy, s.id)
    d = neg.pending_draft(buy, s.id)
    assert d.kind == "offer" and d.price == 250 and "target" in d.rationale
    assert neg.turns(buy, s.id) == []          # nothing was sent yet
    neg.advance(buy, s.id)                       # advancing again does not create another draft
    assert len(buy.fetch("draft", parent=s.id)) == 1

    s = neg.approve_draft(buy, s.id, d.id)
    ts = neg.turns(buy, s.id)
    assert [t.speaker for t in ts] == ["us", "vendor"] and ts[0].author == "bot" and ts[1].price == 285

    for _ in range(10):
        neg.advance(buy, s.id)
        d2 = neg.pending_draft(buy, s.id)
        if d2.price == 270:
            assert d2.payment_code == "ZD45"
            s = neg.approve_draft(buy, s.id, d2.id, price=269)  # the buyer edits the price
            break
        s = neg.approve_draft(buy, s.id, d2.id)
    assert s.status == "agreed" and s.agreed_price == 269
    assert [t.author for t in neg.turns(buy, s.id)][-2] == "human"


def test_a_draft_can_be_discarded_and_replaced_by_hand(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.advance(buy, s.id)
    d = neg.pending_draft(buy, s.id)
    neg.discard_draft(buy, s.id, d.id)
    assert neg.pending_draft(buy, s.id) is None
    with pytest.raises(services.Conflict):
        neg.approve_draft(buy, s.id, d.id)
    s = neg.send_message(buy, s.id, price=255)
    assert neg.turns(buy, s.id)[0].price == 255 and neg.turns(buy, s.id)[0].author == "human"


def test_edited_drafts_still_pass_the_guardrails(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.advance(buy, s.id)
    d = neg.pending_draft(buy, s.id)
    with pytest.raises(services.Conflict):
        neg.approve_draft(buy, s.id, d.id, price=271)
    with pytest.raises(services.Conflict):
        neg.approve_draft(buy, s.id, d.id, text="Our ceiling is 270 so please match 250.")
    assert neg.pending_draft(buy, s.id).id == d.id  # nothing was sent


# --- manual and take-over --------------------------------------------------------------------

def test_manual_mode_never_moves_on_its_own_and_checks_every_message(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    assert neg.advance(buy, s.id).round == 0 and neg.pending_draft(buy, s.id) is None
    for bad in [dict(price=271), dict(price=0), dict(price=260, text="I am an AI assistant"),
                dict(price=260, text="my walk-away is firm"), dict(price=260, text="we can do 270 at most"),
                dict(price=260, payment_code="NET30")]:
        with pytest.raises(services.Conflict):
            neg.send_message(buy, s.id, **bad)
    assert neg.turns(buy, s.id) == []
    s = neg.send_message(buy, s.id, price=260, text="Hello, can you do 260 per unit? Thanks, Dhruvil")
    assert s.round == 1 and neg.turns(buy, s.id)[0].author == "human"


def test_the_buyer_can_stop_auto_and_take_over_mid_conversation(buy: Repo):
    s = neg.start(buy, BUY, mode="auto")
    s = neg.advance(buy, s.id)
    assert s.round == 1 and s.status == "active"
    s = neg.set_mode(buy, s.id, "manual")
    assert neg.advance(buy, s.id).round == 1          # auto stopped
    for _ in range(5):  # the vendor tries for a little more before it says yes
        s = neg.send_message(buy, s.id, price=270)
        if s.status != "active":
            break
    assert s.status == "agreed" and s.agreed_price == 270
    authors = [t.author for t in neg.turns(buy, s.id)]
    assert authors[:2] == ["bot", "vendor"] and set(authors[2:-1]) == {"human", "vendor"} and authors[-2] == "human"


def test_switching_from_approve_to_auto_runs_the_waiting_draft(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.advance(buy, s.id)
    neg.set_mode(buy, s.id, "auto")
    s = neg.advance(buy, s.id)
    assert s.round == 1 and neg.pending_draft(buy, s.id) is None


def test_the_buyer_can_accept_the_vendors_offer_only_inside_the_limit(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(services.Conflict):
        neg.accept_offer(buy, s.id)                   # 285 is above the 270 ceiling
    s = neg.send_message(buy, s.id, price=255)        # vendor comes down to 279 or so
    s = neg.send_message(buy, s.id, price=268)
    if s.status == "active" and deal.within_limit("buy", s.vendor_offer, 270):
        s = neg.accept_offer(buy, s.id)
        assert s.status == "agreed"


# --- hand back -------------------------------------------------------------------------------

def test_a_vendor_that_cannot_reach_the_limit_ends_with_a_hand_back(repo: Repo):
    no_deal = next(e for e in repo.fetch("event") if e.no_deal)
    item = repo.fetch("item", parent=no_deal.id)[0]
    assert item.state == "handed_back"
    services.set_points(repo, item.id, target=item.suggested_target, limit=item.suggested_limit)
    assert item_state(repo, item.id) == "analyzed"
    s = run_auto(repo, neg.start(repo, item.id, mode="auto").id)
    assert s.status == "handed_back" and item_state(repo, item.id) == "handed_back"
    assert s.handback_reason and s.agreed_price is None


def test_the_buyer_can_hand_back_at_any_time(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    neg.advance(buy, s.id)
    s = neg.hand_back(buy, s.id)
    assert s.status == "handed_back" and item_state(buy, BUY) == "handed_back"
    assert neg.pending_draft(buy, s.id) is None
    with pytest.raises(services.Conflict):
        neg.send_message(buy, s.id, price=250)


# --- result, approval, closing ---------------------------------------------------------------

def test_result_continue_accept_and_approve_records_the_outcome(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    before = readmodel.dashboard(readmodel.snapshot(buy)).kpis

    s = neg.continue_negotiation(buy, BUY)
    assert s.status == "active" and s.agreed_price is None and item_state(buy, BUY) == "negotiating"
    s = neg.accept_offer(buy, s.id)                     # the vendor's offer of 270 is inside the limit
    assert s.status == "agreed" and s.agreed_price == 270

    assert neg.accept_deal(buy, BUY).state == "awaiting_approval"
    made = neg.approve_event(buy, "AIS-E1-2026-00077")
    assert len(made) == 1
    o = buy.get("outcome", BUY)
    assert (o.original_price, o.final_price, o.negotiated, o.payment_code) == (285, 270, True, "ZD45")
    assert o.duration_minutes >= 1 and item_state(buy, BUY) == "closed"

    after = readmodel.dashboard(readmodel.snapshot(buy)).kpis
    assert after.completed_negotiations == before.completed_negotiations + 1
    assert after.realised_savings == round(before.realised_savings + 9000, 2)


def test_the_best_quote_can_be_accepted_as_it_stands(buy: Repo):
    assert neg.accept_deal(buy, BUY).state == "awaiting_approval"
    neg.approve_event(buy, "AIS-E1-2026-00077")
    o = buy.get("outcome", BUY)
    assert (o.original_price, o.final_price, o.negotiated, o.duration_minutes) == (285, 285, False, 0)


def test_approval_needs_something_awaiting_and_a_result_to_accept(buy: Repo):
    with pytest.raises(services.Conflict):
        neg.approve_event(buy, "AIS-E1-2026-00077")
    with pytest.raises(services.Conflict):
        neg.continue_negotiation(buy, BUY)
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(lifecycle.InvalidTransition):
        neg.accept_deal(buy, "AIS-E1-2026-00077-02")        # a draft item cannot be accepted
    with pytest.raises(lifecycle.InvalidTransition):
        neg.accept_deal(buy, BUY)                       # still negotiating, nothing agreed
    assert s.status == "active"


def test_unknown_ids_are_not_found(repo: Repo):
    with pytest.raises(services.NotFound):
        neg.advance(repo, "S-NOPE")
    with pytest.raises(services.NotFound):
        neg.start(repo, "NOPE")


# --- sweep over the seeded data --------------------------------------------------------------

def test_auto_negotiation_is_safe_on_every_analyzed_seed_item(repo: Repo):
    """Any language, any direction, any vendor: never outside the limit, never a leak."""
    checked = 0
    for item in repo.fetch("item"):
        if item.state != "analyzed":
            continue
        event = repo.get("event", item.event_id)
        s = run_auto(repo, neg.start(repo, item.id, mode="auto").id)
        target, limit = item.target, item.limit
        assert s.status in ("agreed", "handed_back")
        if s.status == "agreed":
            assert deal.within_limit(event.direction, s.agreed_price, limit)
        for t in neg.turns(repo, s.id):
            if t.speaker == "us":
                guardrails.check_message(t.text, offer_price=t.price, limit=limit, target=target)
                assert deal.within_limit(event.direction, t.price, limit)
        checked += 1
    assert checked >= 20


def test_hero_conversations_take_several_rounds_and_start_with_a_pushback(buy: Repo, sell: Repo):
    for repo_, item, floor in ((buy, BUY, 10), (sell, SELL, 8)):
        s = run_auto(repo_, neg.start(repo_, item, mode="auto").id)
        ts = neg.turns(repo_, s.id)
        assert len(ts) >= floor
        assert ts[1].speaker == "vendor" and ts[1].price == s.original_price  # first answer: no movement
        assert len({t.text for t in ts if t.speaker == "us"}) == len([t for t in ts if t.speaker == "us"])


# --- everyday questions and language ---------------------------------------------------------

def test_vendor_asks_about_quantity_and_delivery_and_our_next_message_answers(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    ts = neg.turns(buy, s.id)
    asked = [t for t in ts if t.speaker == "vendor" and "quantity" in t.text and "?" in t.text]
    assert len(asked) == 1
    after = ts[ts.index(asked[0]) + 1]
    assert after.speaker == "us" and "600 units" in after.text and "delivery" in after.text.lower()
    # we also put a question of our own; the vendor answers it from the quote
    answered = [t for t in ts if t.speaker == "vendor" and "Delivery will be within" in t.text]
    assert answered and "FH" in answered[0].text


def test_buyer_can_ask_a_question_without_making_an_offer(buy: Repo):
    s = neg.start(buy, BUY, mode="manual")
    s = neg.ask_question(buy, s.id, "What is your delivery time and what warranty do you give?")
    ts = neg.turns(buy, s.id)
    assert [t.speaker for t in ts] == ["us", "vendor"] and ts[0].price is None and s.round == 0
    assert "Delivery will be within" in ts[1].text and "warranty" in ts[1].text.lower()
    with pytest.raises(services.Conflict):
        neg.ask_question(buy, s.id, "Our ceiling is 270, can you do it?")
    with pytest.raises(services.Conflict):
        neg.ask_question(buy, s.id, "   ")


def test_changing_the_language_changes_only_the_messages_that_follow(buy: Repo):
    s = neg.start(buy, BUY, mode="approve")
    s = neg.advance(buy, s.id)
    english = neg.pending_draft(buy, s.id).text
    s = neg.set_language(buy, s.id, "hi")
    hindi = neg.pending_draft(buy, s.id).text
    assert s.language == "hi" and english != hindi and "नमस्कार" in hindi
    assert len(buy.fetch("draft", parent=s.id)) == 2 and len([d for d in buy.fetch("draft", parent=s.id) if d.status == "pending"]) == 1
    with pytest.raises(services.Conflict):
        neg.set_language(buy, s.id, "fr")


def test_the_vendor_reacts_to_our_offer_and_sometimes_pauses_before_answering(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    vendor = [t for t in neg.turns(buy, s.id) if t.speaker == "vendor"]
    assert any(t.price is None and "check" in t.text.lower() or "manager" in t.text.lower() for t in vendor)
    reacting = [t.text for t in vendor if t.price is not None][1:]
    assert any(x.startswith(("That is", "Honestly", "We are", "I cannot")) for x in reacting)
