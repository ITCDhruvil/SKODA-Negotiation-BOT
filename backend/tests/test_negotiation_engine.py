import itertools

import pytest

from app import deal
from app.negotiation import guardrails, messages, tactics, vendor_sim


def play(direction, *, target, limit, quote, reserve, flex, objective="reduce_price",
         vendor_payment="ZD30", max_turns=16, persona="cooperative", has_alternative=False, scripted=True):
    """Run the buyer's tactics against the simulated vendor until someone agrees or we hand back."""
    v_price, v_prev, v_pay, v_final, our, rnd = quote, quote, vendor_payment, False, None, 0
    stalls, flags = 0, {"bluff": False, "trade": False, "leverage": False, "split": False, "crawl": False}
    tokens, mood, ult = 0, 0, -1
    log = []
    for _ in range(max_turns):
        ctx = tactics.Context(direction, target, limit, objective, rnd, our, v_price, v_prev,
                              v_pay, v_final, quote, stalls=stalls, bluff_called=flags["bluff"],
                              trade_used=flags["trade"], leverage_used=flags["leverage"],
                              split_used=flags["split"], token_count=tokens, crawl_called=flags["crawl"],
                              has_alternative=has_alternative,
                              alternative="Other Vendor at ₹100" if has_alternative else "")
        dec = tactics.opening(ctx) if our is None else tactics.respond(ctx)
        log.append(("us", dec.kind, dec.price, dec.payment))
        if dec.kind == "accept":
            return "agreed", v_price, v_pay, log
        if dec.kind == "handback":
            return "handback", None, None, log
        our = dec.price
        if dec.tactic in flags:
            flags[dec.tactic] = True
        r = vendor_sim.reply(direction, reserve=reserve, flex=flex, vendor_price=v_price,
                             vendor_payment=v_pay, offer_price=our, offer_payment=dec.payment,
                             round_no=rnd, persona=persona, tactic=dec.tactic, mood=mood, ultimatum_round=ult,
                             scripted=scripted, seed="t")
        log.append(("vendor", r.kind, r.price, r.payment))
        mood = r.mood
        if r.flavour == "ultimatum" and ult < 0:
            ult = rnd
        step = abs(r.price - v_price)
        token = 0 < step <= max(1.0, 0.005 * v_price) and r.payment == v_pay and not scripted
        moved = (step > 0 and not token) or r.payment != v_pay
        tokens = (tokens + 1 if token else (0 if moved else tokens)) if rnd >= 1 else 0
        stalls = stalls + 1 if (not moved and rnd >= 1 and r.kind != "accept") else 0
        if r.ends:
            return "walked", None, None, log
        rnd += 1
        v_prev, v_price, v_pay, v_final = v_price, r.price, r.payment, r.final
        if r.kind == "accept":
            return "agreed", our, r.payment, log
    return "timeout", None, None, log


def test_hero_buy_story_ends_at_270_with_45_day_payment():
    status, price, pay, log = play("buy", target=250, limit=270, quote=285, reserve=268, flex=0.3)
    assert status == "agreed" and price == 270 and pay == "ZD45"
    assert [(w, k, p) for w, k, p, _ in log] == [
        ("us", "offer", 250), ("vendor", "hold", 285), ("us", "offer", 257), ("vendor", "counter", 280),
        ("us", "offer", 262), ("vendor", "counter", 277), ("us", "offer", 265), ("vendor", "counter", 275),
        ("us", "offer", 270), ("vendor", "accept", 270)]
    assert deal.realised_delta("buy", 285, price, 600) == 9000


def test_hero_sell_story_ends_at_167():
    status, price, pay, log = play("sell", target=170, limit=165, quote=163, reserve=169, flex=0.4,
                                   vendor_payment="ADV")
    assert status == "agreed" and price == 167
    assert [(w, k, p) for w, k, p, _ in log] == [
        ("us", "offer", 170), ("vendor", "hold", 163), ("us", "offer", 169), ("vendor", "counter", 164),
        ("us", "offer", 168), ("vendor", "counter", 165), ("us", "offer", 167), ("vendor", "accept", 167)]
    assert deal.realised_delta("sell", 163, price, 5000) == 20000


def test_no_deal_buy_hands_back_when_the_vendor_reserve_is_beyond_the_ceiling():
    status, price, _, log = play("buy", target=250, limit=270, quote=285, reserve=280, flex=0.3)
    assert status == "handback" and price is None


def test_no_deal_sell_hands_back_when_the_bidder_cannot_reach_the_floor():
    status, *_ = play("sell", target=170, limit=165, quote=160, reserve=163, flex=0.4)
    assert status == "handback"


def test_bot_never_offers_or_accepts_outside_the_limit_for_any_vendor():
    cases = itertools.product([0.3, 0.4, 0.5], [262, 268, 270, 275, 285], ["reduce_price", "improve_payment_terms"])
    for flex, reserve, objective in cases:
        status, price, _, log = play("buy", target=250, limit=270, quote=290, reserve=reserve,
                                     flex=flex, objective=objective)
        for who, kind, p, _pay in log:
            if who == "us" and kind == "offer":
                assert p <= 270
        if status == "agreed":
            assert price <= 270 and price >= 250
        elif reserve <= 270:
            pytest.fail(f"a vendor willing to sell at {reserve} should have closed: {status}")
    for flex, reserve in itertools.product([0.3, 0.4, 0.5], [160, 166, 170, 175]):
        status, price, _, log = play("sell", target=175, limit=165, quote=158, reserve=reserve, flex=flex)
        for who, kind, p, _pay in log:
            if who == "us" and kind == "offer":
                assert p >= 165
        if status == "agreed":
            assert price >= 165


def test_payment_objective_asks_for_better_terms_up_front():
    ctx = tactics.Context("buy", 250, 270, "improve_payment_terms", 0, None, 285, 285, "ZD30", False, 285)
    assert tactics.opening(ctx).payment == "ZD60"
    plain = tactics.Context("buy", 250, 270, "reduce_price", 0, None, 285, 285, "ZD30", False, 285)
    assert tactics.opening(plain).payment is None


def test_vendor_grants_at_most_15_extra_days():
    r = vendor_sim.reply("buy", reserve=268, flex=0.3, vendor_price=285, vendor_payment="ZD30",
                         offer_price=270, offer_payment="ZD60", round_no=3)
    assert r.kind == "accept" and r.payment == "ZD30"
    r = vendor_sim.reply("buy", reserve=268, flex=0.3, vendor_price=285, vendor_payment="ZD30",
                         offer_price=270, offer_payment="ZD45", round_no=3)
    assert r.payment == "ZD45"


def test_vendor_never_goes_below_its_reserve_and_flexibility_is_stable():
    assert vendor_sim.flexibility("EVT-2026-041-01-B1") == 0.3
    assert vendor_sim.flexibility("X-1") == vendor_sim.flexibility("X-1")
    r = vendor_sim.reply("buy", reserve=268, flex=0.5, vendor_price=271, vendor_payment="ZD30",
                         offer_price=200, offer_payment=None, round_no=1)
    assert r.price >= 268


def test_rationales_are_buyer_only_but_messages_never_leak_them():
    ctx = tactics.Context("buy", 250, 270, "reduce_price", 3, 265, 275, 277, "ZD30", False, 285)
    dec = tactics.respond(ctx)
    assert "270" in dec.rationale and "ceiling" in dec.rationale
    for lang in messages.LANGS:
        text = messages.our_message(dec.message_kind, direction="buy", lang=lang, vendor_name="Sahyadri Trading",
                                    item="Delegation Lunch Buffet", qty=600, unit="EA", quote=275,
                                    price=dec.price, payment_ask=dec.payment)
        guardrails.check_message(text, offer_price=dec.price, limit=270, target=250)


@pytest.mark.parametrize("lang", messages.LANGS)
@pytest.mark.parametrize("direction", ["buy", "sell"])
@pytest.mark.parametrize("kind", ["open", "counter", "close", "accept"])
def test_every_template_renders_and_passes_the_guardrails(lang, direction, kind):
    text = messages.our_message(kind, direction=direction, lang=lang, vendor_name="Konkan Enterprises LLP",
                                item="Aluminium Turnings", qty=5000, unit="KG", quote=163, price=168,
                                payment_ask="ZD15", agreed_payment="ZD30")
    assert "{" not in text and "}" not in text
    assert "\n" not in text
    guardrails.check_message(text, offer_price=168, limit=165, target=170)
    for vk in ("counter", "firm", "accept"):
        vt = messages.vendor_message(vk, direction=direction, lang=lang, price=166, unit="KG", payment="ZD30")
        assert "{" not in vt and "166" in vt


def test_money_uses_indian_grouping():
    assert messages.money(285) == "₹285"
    assert messages.money(1234567) == "₹12,34,567"
    assert messages.money(46.5) == "₹46.50"


class TestGuardrails:
    def test_offer_limits(self):
        guardrails.check_offer("buy", 270, 270)
        with pytest.raises(guardrails.GuardrailError):
            guardrails.check_offer("buy", 271, 270)
        guardrails.check_offer("sell", 165, 165)
        with pytest.raises(guardrails.GuardrailError):
            guardrails.check_offer("sell", 164, 165)
        with pytest.raises(guardrails.GuardrailError):
            guardrails.check_offer("buy", 0, 270)

    @pytest.mark.parametrize("text", [
        "I am an AI assistant", "this is our procurement bot", "sent by an automated system",
        "my chatbot says", "the language model suggests"])
    def test_messages_may_not_reveal_software(self, text):
        with pytest.raises(guardrails.GuardrailError):
            guardrails.check_message(text, offer_price=260, limit=270, target=250)

    @pytest.mark.parametrize("text", [
        "our ceiling is firm", "we have a budget", "walk-away price", "our target is low",
        "my limit is 260", "we can go to 270 but not more", "we were hoping for 250"])
    def test_messages_may_not_reveal_internal_positions(self, text):
        with pytest.raises(guardrails.GuardrailError):
            guardrails.check_message(text, offer_price=260, limit=270, target=250)

    def test_offer_price_may_equal_an_internal_number(self):
        guardrails.check_message("We can do 270 per unit.", offer_price=270, limit=270, target=250)

    def test_ordinary_words_are_fine(self):
        guardrails.check_message("Thanks, please share the delivery plan. Chai and snacks included.",
                                 offer_price=260, limit=270, target=250)


def test_a_vendor_that_creeps_a_rupee_a_round_is_called_out_and_not_taken_for_progress():
    status, price, pay, log = play("buy", target=250, limit=270, quote=285, reserve=262, flex=0.3,
                                   persona="crawler", scripted=False, max_turns=30)
    steps = [(w, k) for w, k, *_ in log]
    assert ("us", "offer") in steps
    prices = [p for w, _, p, _ in log if w == "vendor"]
    assert any(0 < abs(a - b) <= 1 for a, b in zip(prices, prices[1:]))  # it really does move by a rupee
    assert status in ("agreed", "handback")  # the buyer does not just keep nudging for ever


def test_crawler_jumps_when_terms_are_traded():
    r = vendor_sim.reply("buy", reserve=262, flex=0.3, vendor_price=280, vendor_payment="ZD30", offer_price=268,
                         offer_payment="ZD45", round_no=3, persona="crawler", tactic="trade", scripted=True)
    assert r.price < 279


def test_crawler_alone_moves_a_rupee():
    r = vendor_sim.reply("buy", reserve=262, flex=0.3, vendor_price=280, vendor_payment="ZD30", offer_price=268,
                         offer_payment=None, round_no=3, persona="crawler", scripted=True)
    assert r.price == 279


def test_a_hard_vendor_irritated_after_a_final_price_leaves_and_a_scripted_one_never_does():
    kw = dict(reserve=262, flex=0.3, vendor_price=270, vendor_payment="ZD30", offer_price=240, offer_payment=None,
              round_no=6, persona="anchor", mood=70, ultimatum_round=3, seed="x")
    assert vendor_sim.reply("buy", **kw).ends
    assert not vendor_sim.reply("buy", scripted=True, **kw).ends
    assert not vendor_sim.reply("buy", **{**kw, "persona": "cooperative"}).ends  # cooperative vendors do not walk away
    assert not vendor_sim.reply("buy", **{**kw, "offer_price": 265}).ends  # an acceptable offer is never refused


def test_mood_rises_with_low_offers_and_eases_when_we_come_close():
    low = vendor_sim.next_mood(0, accepts=False, offer_price=230, reserve=262, our_prev=None)
    assert low > 15
    assert vendor_sim.next_mood(low, accepts=True, offer_price=265, reserve=262, our_prev=230) < low
