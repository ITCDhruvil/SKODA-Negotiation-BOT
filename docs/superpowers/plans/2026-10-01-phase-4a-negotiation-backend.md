# Phase 4a: Negotiation Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested backend for buyer-started negotiations: a rule-based simulated vendor, the buyer-side tactics, three permission modes (full auto, approve each message, manual) that the buyer can switch at any time, guardrails that keep every message in a person's voice and keep internal numbers private, and the result / accept / approve / close flow that records outcomes.

**Architecture:** A new package `backend/app/negotiation/` (`messages`, `guardrails`, `vendor_sim`, `tactics`, `service`, `views`). All price maths goes through new helpers in `app/deal.py` (`concede`, `opposite`, `round_price`, payment ladder), so buy and sell share one code path. Sessions, turns and drafts are stored as documents in the existing SQLite store. The API adds session routes; the frontend (Phase 4b) drives auto mode by calling `advance` repeatedly.

**Tech Stack:** Python 3.11, FastAPI, pydantic 2, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-main-negotiation-bot-design.md` (sections 4, 5 and 7). Builds on Phases 1 to 3 (done, 225 backend tests).

## Global Constraints

- **The counterparty must never be told it is talking to software.** Every outgoing message reads like a person at the company wrote it and is signed with the buyer's name; `guardrails.check_message` rejects any text that mentions AI, bots, assistants, automation and the like, in every mode, including text the buyer types or edits.
- **Internal positions never leave the building.** Outgoing text may not contain the words ceiling, floor, limit, target, budget, walk-away, reserve, and may not contain a number equal to the buyer's target or limit unless it equals the price being offered in that same message. Rationales and recommendations are buyer-only and are never sent.
- **The buyer stays in control.** A negotiation only starts when the buyer starts it. Three modes, changeable at any time while a session is active: `auto` (each `advance` plays one full round), `approve` (each move is a draft the buyer approves, edits or discards), `manual` (nothing happens unless the buyer sends). Switching to `manual` is how the buyer stops and takes over.
- **Never outside the limit.** Every offer, in every mode, must satisfy `deal.within_limit(direction, price, limit)`; accepting the vendor's price needs the same. Approval refuses a result outside the limit.
- **No hidden vendor value in any response:** the vendor's reserve (`Dataset.reserves`) and flexibility are used only inside `vendor_sim` and never appear in a view, a turn, a draft or an error message.
- Money maths only in `app/deal.py`; no `direction ==` branching outside `app/deal.py` and `app/seed/` (the message templates are keyed by direction and are the one allowed exception, in `app/negotiation/messages.py`).
- Negotiable terms in this phase: price and payment terms. Incoterm, delivery/pickup days, warranty, validity and penalty carry over unchanged from the vendor's bid (recorded as assumption 77).
- Vendor replies are rule-based (no model calls), deterministic, and available in English, Hindi and Marathi.
- Run commands from `D:\main-negotiation-bot\backend` with `python -m pytest -q -p no:asyncio`. Commit messages: one short plain paragraph, no prefix, no bullets, no attribution. Write files as UTF-8 without a byte order mark.

## File Structure

```
backend/
  app/clock.py                 single place that reads the wall clock (tests replace it)
  app/deal.py                  (modify: opposite, round_price, concede, payment ladder)
  app/lifecycle.py             (modify: analyzed -> awaiting_approval)
  app/models.py                (modify: Session, Turn, Draft)
  app/store.py                 (modify: session, turn, draft kinds)
  app/schemas.py               (modify: session views)
  app/api.py                   (modify: session routes)
  app/negotiation/__init__.py, messages.py, guardrails.py, vendor_sim.py, tactics.py, service.py, views.py
  openapi.json                 regenerated
  tests/test_deal_negotiation.py, test_negotiation_engine.py, test_negotiation_service.py, test_negotiation_api.py
frontend/lib/api-types.ts      regenerated
```

---

### Task 1: Deal helpers, clock and the accept-as-is transition

**Files:**
- Modify: `backend/app/deal.py` (one import line, one typing import, append), `backend/app/lifecycle.py`, `backend/tests/test_lifecycle.py`
- Create: `backend/app/clock.py`, `backend/tests/test_deal_negotiation.py`

**Interfaces:**
- Produces: `deal.opposite(direction)`, `deal.round_price(x)` (whole rupees from 100 up, paise below, halves round up), `deal.concede(mover, current, other, bound, fraction)` (moves `current` toward `other` by `fraction`, rounded, never past the mover's `bound`), `deal.better_payment(direction, a, b)`, `deal.next_better_payment(direction, code) -> Optional[str]`; `clock.now()`; lifecycle transition `analyzed -> awaiting_approval` (accept the best quote as it stands).

- [ ] **Step 1: Write the failing tests**


**File:** `backend/tests/test_deal_negotiation.py`

```python
import pytest

from app import deal


def test_opposite():
    assert deal.opposite("buy") == "sell"
    assert deal.opposite("sell") == "buy"
    with pytest.raises(ValueError):
        deal.opposite("swap")


def test_round_price_rounds_half_up_and_keeps_paise_below_100():
    assert deal.round_price(274.5) == 275.0
    assert deal.round_price(165.8) == 166.0
    assert deal.round_price(46.789) == 46.79
    assert deal.round_price(99.995) == 100.0


def test_concede_moves_toward_the_other_side_for_a_buyer():
    # we (buy) offer 250; vendor asks 275; we move 40% of the way
    assert deal.concede("buy", 250, 275, 270, 0.4) == 260.0


def test_concede_never_passes_the_movers_bound_buy():
    assert deal.concede("buy", 250, 400, 270, 0.9) == 270.0


def test_concede_moves_a_seller_down_and_respects_the_floor():
    assert deal.concede("sell", 170, 166, 165, 0.4) == 168.0
    assert deal.concede("sell", 170, 100, 165, 0.9) == 165.0


def test_concede_for_the_vendor_side_uses_the_opposite_direction():
    # in a buy event the vendor sells: comes down from 285 toward our 250 but never below 268
    assert deal.concede("sell", 285, 250, 268, 0.3) == 275.0
    assert deal.concede("sell", 271, 264, 268, 0.9) == 268.0
    # in a sell event the vendor buys: comes up from 163 toward our 170 but never above 169
    assert deal.concede("buy", 163, 170, 169, 0.4) == 166.0


def test_concede_rejects_bad_fraction():
    with pytest.raises(ValueError):
        deal.concede("buy", 1, 2, 3, 1.5)


def test_payment_ladder_moves_the_right_way_for_each_side():
    assert deal.next_better_payment("buy", "ZD30") == "ZD45"
    assert deal.next_better_payment("buy", "ZD60") is None
    assert deal.next_better_payment("sell", "ZD30") == "ZD15"
    assert deal.next_better_payment("sell", "ADV") is None
    assert deal.next_better_payment("sell", "LC") is None
    assert deal.next_better_payment("buy", "ADV") == "ZD15"


def test_better_payment_compares_days_by_direction():
    assert deal.better_payment("buy", "ZD45", "ZD30")
    assert not deal.better_payment("buy", "ZD30", "ZD45")
    assert deal.better_payment("sell", "ADV", "ZD30")
    assert not deal.better_payment("sell", "ZD30", "ZD30")
```


Edit `backend/tests/test_lifecycle.py`: in `test_nothing_can_strand_an_item_back_at_points_reviewed` change the last assertion to

```python
    assert lc.TRANSITIONS["analyzed"] == frozenset({"negotiating", "awaiting_approval"})
```

and append:

```python
def test_the_best_quote_can_be_accepted_as_is_from_analyzed():
    assert lc.can_transition("analyzed", "awaiting_approval")
    assert not lc.can_transition("analyzed", "closed")
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_deal_negotiation.py tests/test_lifecycle.py -q -p no:asyncio`
Expected: FAIL (`AttributeError: module 'app.deal' has no attribute 'opposite'`, lifecycle assertion).

- [ ] **Step 3: Implement**


**File:** `backend/app/clock.py`

```python
"""One place that reads the wall clock, so tests can replace it."""
from __future__ import annotations

from datetime import datetime, timezone


def now() -> datetime:
    """Current time in UTC, to the second."""
    return datetime.now(timezone.utc).replace(microsecond=0)
```


In `backend/app/deal.py`: add `import math` next to the other imports, add `Optional` to the `from typing import ...` line, and append this at the end of the file:


```python
# --- negotiation helpers -------------------------------------------------------------------

def opposite(direction: Direction) -> Direction:
    """The counterparty's direction: a buyer's vendor sells, a seller's vendor buys."""
    _check(direction)
    return "sell" if direction == "buy" else "buy"


def round_price(x: float) -> float:
    """Whole rupees from 100 up, paise below; halves round up."""
    if x >= 100:
        return float(math.floor(x + 0.5))
    return math.floor(x * 100 + 0.5) / 100


def concede(mover: Direction, current: float, other: float, bound: float, fraction: float) -> float:
    """Move `current` toward `other` by `fraction`, never past `bound` (the mover's walk-away).

    `mover` is the direction of whoever is moving: a buyer moves up toward the seller's price but
    never above their ceiling; a seller moves down but never below their floor.
    """
    _check(mover)
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must be between 0 and 1")
    moved = round_price(current + fraction * (other - current))
    return moved if within_limit(mover, moved, bound) else bound


_LADDER = ("ADV", "ZD15", "ZD30", "ZD45", "ZD60")


def better_payment(direction: Direction, a: str, b: str) -> bool:
    """True when payment code `a` is strictly better for us than `b`.

    A buyer prefers to pay later; a seller prefers to be paid sooner.
    """
    _check(direction)
    da, db = payment_days(a), payment_days(b)
    return da > db if direction == "buy" else da < db


def next_better_payment(direction: Direction, code: str) -> Optional[str]:
    """The next payment tier that is better for us than `code`, or None if already the best."""
    _check(direction)
    days = payment_days(code)
    steps = [(payment_days(c), c) for c in _LADDER]
    if direction == "buy":
        better = [c for d, c in steps if d > days]
        return better[0] if better else None
    better = [c for d, c in steps if d < days]
    return better[-1] if better else None
```


In `backend/app/lifecycle.py` change the `analyzed` entry to

```python
    "analyzed": frozenset({"negotiating", "awaiting_approval"}),
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest -q -p no:asyncio`
Expected: everything passes (225 existing + the new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/clock.py backend/app/deal.py backend/app/lifecycle.py backend/tests/test_deal_negotiation.py backend/tests/test_lifecycle.py
git commit -m "Add negotiation price helpers, a clock module and the accept-as-is transition."
```

---

### Task 2: Session, turn and draft models in the store

**Files:**
- Modify: `backend/app/models.py`, `backend/app/store.py`

**Interfaces:**
- Produces: `models.Mode` (`auto|approve|manual`), `SessionStatus` (`active|agreed|handed_back`), `DraftKind` (`offer|accept|handback`), `Session`, `Turn` (with `author`: `bot|human|vendor`, internal audit only), `Draft` (with a buyer-only `rationale`); store kinds `session` (parent item id), `turn` and `draft` (parent session id).

- [ ] **Step 1: Implement**

In `backend/app/models.py` change `from datetime import date` to `from datetime import date, datetime`, and append to the end of the file:


```python
# --- negotiation ---------------------------------------------------------------------------

Mode = Literal["auto", "approve", "manual"]
SessionStatus = Literal["active", "agreed", "handed_back"]
DraftKind = Literal["offer", "accept", "handback"]


class Session(_Model):
    """One negotiation with one vendor on one item."""

    id: str
    item_id: str
    vendor_id: str
    bid_id: str
    mode: Mode
    status: SessionStatus
    language: Language
    round: int  # vendor replies received so far
    original_price: float  # the vendor's own quote when the session started
    original_payment: str
    our_offer: Optional[float]
    our_payment: Optional[str]
    vendor_offer: float
    previous_vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    agreed_price: Optional[float]
    agreed_payment: Optional[str]
    handback_reason: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]


class Turn(_Model):
    id: str
    session_id: str
    seq: int
    speaker: Literal["us", "vendor"]
    author: Literal["bot", "human", "vendor"]  # internal audit only; never shown to the vendor
    text: str
    price: Optional[float]
    payment_code: Optional[str]
    at: datetime


class Draft(_Model):
    """A move prepared for the buyer to approve, edit or discard."""

    id: str
    session_id: str
    kind: DraftKind
    price: Optional[float]
    payment_code: Optional[str]
    text: str
    rationale: str  # buyer-only reasoning; never sent to the vendor
    created: datetime
    status: Literal["pending", "sent", "discarded"]
```


In `backend/app/store.py` change the models import to
`from app.models import Bid, Dataset, Draft, Event, HistoryRecord, Item, Outcome, Session, Turn, Vendor`
and add three kinds to `KINDS`: after `"reserve": None,` add

```python
    "session": Session, "turn": Turn, "draft": Draft,
```

- [ ] **Step 2: Verify**

Run: `python -c "from app.models import Session, Turn, Draft; from app.store import Repo; print('ok')"` then `python -m pytest -q -p no:asyncio`
Expected: `ok`, then all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py backend/app/store.py
git commit -m "Add the negotiation session, turn and draft models and store kinds."
```

---

### Task 3: Message wording, guardrails, simulated vendor and buyer tactics

**Files:**
- Create: `backend/app/negotiation/__init__.py`, `messages.py`, `guardrails.py`, `vendor_sim.py`, `tactics.py`, `backend/tests/test_negotiation_engine.py`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `messages.our_message(kind, *, direction, lang, vendor_name, item, qty, unit, quote, price, payment_ask=None, agreed_payment=None, signature=SIGNATURE)` (kinds `open|counter|close|accept`), `messages.vendor_message(kind, *, direction, lang, price, unit, payment=None)` (kinds `counter|firm|accept`), `messages.money`, `messages.LANGS`; `guardrails.check_offer(direction, price, limit)`, `guardrails.check_message(text, *, offer_price, limit, target)`, `GuardrailError`; `vendor_sim.reply(...) -> VendorReply`, `vendor_sim.flexibility(bid_id)`; `tactics.Context`, `tactics.Decision(kind, message_kind, price, payment, rationale)`, `tactics.opening(ctx)`, `tactics.respond(ctx)`.
- Behaviour pinned by tests: hero BUY: bot opens 250, vendor counters 275, bot asks 270 with 45-day payment, vendor accepts (realised saving 9,000); hero SELL: opens 170, vendor 166, bot 168, accepted (uplift 25,000); a vendor whose reserve is beyond the limit ends in a hand-back.

- [ ] **Step 1: Write the failing tests**


**File:** `backend/tests/test_negotiation_engine.py`

```python
import itertools

import pytest

from app import deal
from app.negotiation import guardrails, messages, tactics, vendor_sim


def play(direction, *, target, limit, quote, reserve, flex, objective="reduce_price",
         vendor_payment="ZD30", max_turns=12):
    """Run the bot against the simulated vendor until someone agrees or the bot hands back."""
    v_price, v_prev, v_pay, v_final, our, rnd = quote, quote, vendor_payment, False, None, 0
    log = []
    for _ in range(max_turns):
        ctx = tactics.Context(direction, target, limit, objective, rnd, our, v_price, v_prev,
                              v_pay, v_final, quote)
        dec = tactics.opening(ctx) if our is None else tactics.respond(ctx)
        log.append(("us", dec.kind, dec.price, dec.payment))
        if dec.kind == "accept":
            return "agreed", v_price, v_pay, log
        if dec.kind == "handback":
            return "handback", None, None, log
        our = dec.price
        r = vendor_sim.reply(direction, reserve=reserve, flex=flex, vendor_price=v_price,
                             vendor_payment=v_pay, offer_price=our, offer_payment=dec.payment,
                             round_no=rnd)
        log.append(("vendor", r.kind, r.price, r.payment))
        rnd += 1
        v_prev, v_price, v_pay, v_final = v_price, r.price, r.payment, r.final
        if r.kind == "accept":
            return "agreed", our, r.payment, log
    return "timeout", None, None, log


def test_hero_buy_story_ends_at_270_with_45_day_payment():
    status, price, pay, log = play("buy", target=250, limit=270, quote=285, reserve=268, flex=0.3)
    assert status == "agreed" and price == 270 and pay == "ZD45"
    assert [(w, k, p) for w, k, p, _ in log] == [
        ("us", "offer", 250), ("vendor", "counter", 275), ("us", "offer", 270), ("vendor", "accept", 270)]
    assert deal.realised_delta("buy", 285, price, 600) == 9000


def test_hero_sell_story_ends_at_168():
    status, price, pay, log = play("sell", target=170, limit=165, quote=163, reserve=169, flex=0.4,
                                   vendor_payment="ADV")
    assert status == "agreed" and price == 168
    assert [(w, k, p) for w, k, p, _ in log] == [
        ("us", "offer", 170), ("vendor", "counter", 166), ("us", "offer", 168), ("vendor", "accept", 168)]
    assert deal.realised_delta("sell", 163, price, 5000) == 25000


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
                         offer_price=270, offer_payment="ZD60", round_no=1)
    assert r.kind == "accept" and r.payment == "ZD30"
    r = vendor_sim.reply("buy", reserve=268, flex=0.3, vendor_price=285, vendor_payment="ZD30",
                         offer_price=270, offer_payment="ZD45", round_no=1)
    assert r.payment == "ZD45"


def test_vendor_never_goes_below_its_reserve_and_flexibility_is_stable():
    assert vendor_sim.flexibility("EVT-2026-041-01-B1") == 0.3
    assert vendor_sim.flexibility("X-1") == vendor_sim.flexibility("X-1")
    r = vendor_sim.reply("buy", reserve=268, flex=0.5, vendor_price=271, vendor_payment="ZD30",
                         offer_price=200, offer_payment=None, round_no=1)
    assert r.price >= 268


def test_rationales_are_buyer_only_but_messages_never_leak_them():
    ctx = tactics.Context("buy", 250, 270, "reduce_price", 1, 250, 275, 285, "ZD30", False, 285)
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
    assert "Dhruvil Patel" in text
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
```


- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_negotiation_engine.py -q -p no:asyncio`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.negotiation'`).

- [ ] **Step 3: Implement**


**File:** `backend/app/negotiation/__init__.py`

```python
"""Negotiation engine: message wording, guardrails, a rule-based vendor and the buyer-side tactics."""
```



**File:** `backend/app/negotiation/messages.py`

```python
"""Message wording for both sides, in English, Hindi and Marathi.

Messages from our side read like a person at the company wrote them and are signed with a name;
they never mention software, assistants or automation (see guardrails.check_message).
"""
from __future__ import annotations

from typing import Optional

from app import deal

LANGS = ("en", "hi", "mr")
SIGNATURE = "Dhruvil Patel\nSKODA Auto VW India, Pune"

_UNIT = {
    "en": {"EA": "unit", "AU": "lot", "KG": "kg", "TON": "ton", "LOT": "lot"},
    "hi": {"EA": "नग", "AU": "लॉट", "KG": "किलो", "TON": "टन", "LOT": "लॉट"},
    "mr": {"EA": "नग", "AU": "लॉट", "KG": "किलो", "TON": "टन", "LOT": "लॉट"},
}


def _group(n: int) -> str:
    """Indian digit grouping: 1,23,456."""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + s


def money(x: float) -> str:
    """₹ amount with Indian grouping; paise only when present."""
    whole = int(x)
    if x == whole:
        return f"₹{_group(whole)}"
    return f"₹{_group(whole)}.{round((x - whole) * 100):02d}"


def _qty(x: float) -> str:
    return _group(int(x)) if x == int(x) else f"{x:,.2f}"


def payment_phrase(lang: str, direction: str, code: Optional[str]) -> str:
    """A sentence about payment timing, or '' when there is nothing to ask."""
    if not code:
        return ""
    days = deal.payment_days(code)
    if direction == "buy":  # we pay: we ask for more days
        return {
            "en": f" Also, could we settle the payment in {days} days?",
            "hi": f" साथ ही, क्या हम भुगतान {days} दिन में कर सकते हैं?",
            "mr": f" तसेच, आम्ही पेमेंट {days} दिवसांत केले तर चालेल का?",
        }[lang]
    if days == 0:  # we are paid: we ask for it sooner
        return {
            "en": " We would also need the payment in advance.",
            "hi": " साथ ही भुगतान अग्रिम रूप से चाहिए।",
            "mr": " तसेच पेमेंट आगाऊ हवे आहे.",
        }[lang]
    return {
        "en": f" We would also need the payment within {days} days.",
        "hi": f" साथ ही भुगतान {days} दिन के भीतर चाहिए।",
        "mr": f" तसेच पेमेंट {days} दिवसांच्या आत हवे आहे.",
    }[lang]


def _agreed_payment(lang: str, code: Optional[str]) -> str:
    if not code:
        return ""
    days = deal.payment_days(code)
    if days == 0:
        return {"en": " Payment in advance.", "hi": " भुगतान अग्रिम।", "mr": " पेमेंट आगाऊ."}[lang]
    return {
        "en": f" Payment in {days} days.",
        "hi": f" भुगतान {days} दिन में।",
        "mr": f" पेमेंट {days} दिवसांत.",
    }[lang]


# (kind, event direction, language) -> template. Placeholders: {vendor} {item} {qty} {unit}
# {quote} {price} {pay} {sign}
_OURS: dict[tuple[str, str, str], str] = {
    ("open", "buy", "en"): (
        "Hello {vendor} team, thank you for your quotation of {quote} per {unit} for {qty} {unit} of "
        "{item}. For this quantity we were looking at around {price} per {unit}. Could you please "
        "revisit your price?{pay}\n\nRegards,\n{sign}"),
    ("open", "buy", "hi"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} का कोटेशन देने के लिए "
        "धन्यवाद। इस मात्रा के लिए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। क्या आप कृपया "
        "अपनी कीमत पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "buy", "mr"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} दराने कोटेशन दिल्याबद्दल "
        "धन्यवाद. या प्रमाणासाठी आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया आपल्या "
        "किमतीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "en"): (
        "Thanks for coming back to us. We can move to {price} per {unit}.{pay} Would that work for "
        "you?\n\nRegards,\n{sign}"),
    ("counter", "buy", "hi"): (
        "आपके जवाब के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको मंज़ूर "
        "होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "mr"): (
        "उत्तर दिल्याबद्दल धन्यवाद. आम्ही {price} प्रति {unit} पर्यंत येऊ शकतो.{pay} हे आपल्याला "
        "मान्य आहे का?\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "en"): (
        "Thank you. If you can do {price} per {unit}, we can go ahead with the order today.{pay}"
        "\n\nRegards,\n{sign}"),
    ("close", "buy", "hi"): (
        "धन्यवाद। अगर आप {price} प्रति {unit} कर दें तो हम आज ही ऑर्डर आगे बढ़ा सकते हैं।{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "mr"): (
        "धन्यवाद. जर आपण {price} प्रति {unit} केले तर आम्ही आजच ऑर्डर पुढे नेऊ शकतो.{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "buy", "en"): (
        "Alright, {price} per {unit} is fine with us.{pay} Thank you for working with us on this."
        "\n\nRegards,\n{sign}"),
    ("accept", "buy", "hi"): (
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} इसमें सहयोग के लिए धन्यवाद।"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "buy", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} सहकार्याबद्दल धन्यवाद."
        "\n\nधन्यवाद,\n{sign}"),
    ("open", "sell", "en"): (
        "Hello {vendor} team, thank you for your bid of {quote} per {unit} for {qty} {unit} of "
        "{item}. Going by current market levels we were expecting around {price} per {unit}. Could "
        "you please revisit your bid?{pay}\n\nRegards,\n{sign}"),
    ("open", "sell", "hi"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} की बोली के लिए "
        "धन्यवाद। मौजूदा बाज़ार भाव को देखते हुए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। "
        "क्या आप अपनी बोली पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "sell", "mr"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} बोली दिल्याबद्दल "
        "धन्यवाद. सध्याच्या बाजारभावानुसार आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया "
        "आपल्या बोलीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "en"): (
        "Thanks for the revised bid. We can come down to {price} per {unit}.{pay} Would that work "
        "for you?\n\nRegards,\n{sign}"),
    ("counter", "sell", "hi"): (
        "संशोधित बोली के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको "
        "मंज़ूर होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "mr"): (
        "सुधारित बोलीबद्दल धन्यवाद. आम्ही {price} प्रति {unit} पर्यंत खाली येऊ शकतो.{pay} हे "
        "आपल्याला मान्य आहे का?\n\nधन्यवाद,\n{sign}"),
    ("close", "sell", "en"): (
        "Thank you. If you can do {price} per {unit}, we can release the lot to you this week.{pay}"
        "\n\nRegards,\n{sign}"),
    ("close", "sell", "hi"): (
        "धन्यवाद। अगर आप {price} प्रति {unit} कर दें तो हम इसी हफ़्ते माल आपको दे सकते हैं।{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("close", "sell", "mr"): (
        "धन्यवाद. जर आपण {price} प्रति {unit} केले तर आम्ही याच आठवड्यात माल आपल्याला देऊ शकतो.{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "sell", "en"): (
        "Alright, {price} per {unit} is fine with us.{pay} Thank you.\n\nRegards,\n{sign}"),
    ("accept", "sell", "hi"): (
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} धन्यवाद।\n\nधन्यवाद,\n{sign}"),
    ("accept", "sell", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} धन्यवाद.\n\nधन्यवाद,\n{sign}"),
}

# (kind, event direction, language). In a buy event the vendor sells; in a sell event the vendor buys.
_VENDOR: dict[tuple[str, str, str], str] = {
    ("counter", "buy", "en"): "Thanks for the feedback. For this quantity the best I can do is {price} per {unit}.",
    ("counter", "buy", "hi"): "फीडबैक के लिए धन्यवाद। इस मात्रा के लिए मैं {price} प्रति {unit} तक कर सकता हूँ।",
    ("counter", "buy", "mr"): "अभिप्रायाबद्दल धन्यवाद. या प्रमाणासाठी मी {price} प्रति {unit} पर्यंत करू शकतो.",
    ("firm", "buy", "en"): "I understand, but {price} per {unit} really is the lowest I can go. That is my final price.",
    ("firm", "buy", "hi"): "मैं समझता हूँ, लेकिन {price} प्रति {unit} इससे कम नहीं हो पाएगा। यही मेरी अंतिम कीमत है।",
    ("firm", "buy", "mr"): "मला समजते, पण {price} प्रति {unit} यापेक्षा कमी होणार नाही. हीच माझी अंतिम किंमत आहे.",
    ("accept", "buy", "en"): "Alright, {price} per {unit} works for us.{pay} We can confirm the order on these terms.",
    ("accept", "buy", "hi"): "ठीक है, {price} प्रति {unit} हमारे लिए चलेगा।{pay} इन शर्तों पर हम ऑर्डर कन्फ़र्म कर सकते हैं।",
    ("accept", "buy", "mr"): "ठीक आहे, {price} प्रति {unit} आम्हाला चालेल.{pay} या अटींवर आम्ही ऑर्डर निश्चित करू शकतो.",
    ("counter", "sell", "en"): "Thanks. I can improve my bid to {price} per {unit}.",
    ("counter", "sell", "hi"): "धन्यवाद। मैं अपनी बोली बढ़ाकर {price} प्रति {unit} कर सकता हूँ।",
    ("counter", "sell", "mr"): "धन्यवाद. मी माझी बोली वाढवून {price} प्रति {unit} करू शकतो.",
    ("firm", "sell", "en"): "That is the most I can pay: {price} per {unit}. It is my final bid.",
    ("firm", "sell", "hi"): "इससे ज़्यादा मैं नहीं दे सकता: {price} प्रति {unit}। यही मेरी अंतिम बोली है।",
    ("firm", "sell", "mr"): "यापेक्षा जास्त मी देऊ शकत नाही: {price} प्रति {unit}. हीच माझी अंतिम बोली आहे.",
    ("accept", "sell", "en"): "Okay, {price} per {unit} is fine.{pay} We can lift the material on these terms.",
    ("accept", "sell", "hi"): "ठीक है, {price} प्रति {unit} मंज़ूर है।{pay} इन शर्तों पर हम माल उठा लेंगे।",
    ("accept", "sell", "mr"): "ठीक आहे, {price} प्रति {unit} मान्य आहे.{pay} या अटींवर आम्ही माल उचलू.",
}


def _short(vendor_name: str) -> str:
    return vendor_name.split()[0] if vendor_name else "there"


def our_message(
    kind: str, *, direction: str, lang: str, vendor_name: str, item: str, qty: float, unit: str,
    quote: float, price: float, payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None,
    signature: str = SIGNATURE,
) -> str:
    """The text we send. `quote` is the vendor's current price; `price` is what we propose."""
    template = _OURS[(kind, direction, lang)]
    pay = payment_phrase(lang, direction, payment_ask) if kind != "accept" else _agreed_payment(lang, agreed_payment)
    return template.format(
        vendor=_short(vendor_name), item=item, qty=_qty(qty), unit=_UNIT[lang].get(unit, unit),
        quote=money(quote), price=money(price), pay=pay, sign=signature)


def vendor_message(
    kind: str, *, direction: str, lang: str, price: float, unit: str, payment: Optional[str] = None,
) -> str:
    """The simulated vendor's reply text."""
    template = _VENDOR[(kind, direction, lang)]
    return template.format(
        price=money(price), unit=_UNIT[lang].get(unit, unit),
        pay=_agreed_payment(lang, payment) if payment else "")
```



**File:** `backend/app/negotiation/guardrails.py`

```python
"""Rules every outgoing offer and message must pass before it reaches the vendor."""
from __future__ import annotations

import re
from typing import Optional

from app import deal


class GuardrailError(Exception):
    """An outgoing offer or message broke a rule; the reason is safe to show to the buyer."""


# We speak as a person at the company. Nothing we send may say otherwise.
_AI_WORDS = re.compile(
    r"\b(ai|a\.i\.|bot|chatbot|assistant|automated|automation|algorithm|llm|gpt|"
    r"language model|artificial intelligence|machine)\b", re.IGNORECASE)

# Internal positions never leave the building.
_INTERNAL_WORDS = re.compile(
    r"\b(ceiling|floor|walk[- ]?away|limit|target|reserve|budget|max(imum)? price)\b", re.IGNORECASE)

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[float]:
    out = []
    for token in _NUMBER.findall(text):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:
            continue
    return out


def check_offer(direction: str, price: float, limit: float) -> None:
    if price <= 0:
        raise GuardrailError("The price must be a positive number.")
    if not deal.within_limit(direction, price, limit):
        side = "above your ceiling" if direction == "buy" else "below your floor"
        raise GuardrailError(f"That price is {side}, so it cannot be sent.")


def check_message(
    text: str, *, offer_price: Optional[float], limit: float, target: float,
) -> None:
    """Reject text that reveals our internal numbers or says it was written by software."""
    if _AI_WORDS.search(text):
        raise GuardrailError("The message mentions automation. Messages must read as written by a person.")
    if _INTERNAL_WORDS.search(text):
        raise GuardrailError("The message mentions an internal position such as a limit or target.")
    for n in _numbers(text):
        if offer_price is not None and abs(n - offer_price) < 0.005:
            continue
        for secret in (limit, target):
            if abs(n - secret) < 0.005:
                raise GuardrailError("The message contains a number that matches an internal target or limit.")
```



**File:** `backend/app/negotiation/vendor_sim.py`

```python
"""A rule-based stand-in for the vendor. It knows a hidden reserve price and how flexible it is.

The vendor moves part of the way toward our offer each round and never past its reserve. If our
offer already meets its reserve it accepts. Nothing here calls a model, so runs are repeatable.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Optional

from app import deal

# Demo vendors with a known story (spec section 5): the best bidder on each hero item.
HERO_FLEX = {"EVT-2026-041-01-B1": 0.3, "EVT-2026-052-01-B1": 0.4}
_FLEX = (0.3, 0.4, 0.5)
MAX_VENDOR_ROUNDS = 5
GRANT_PAYMENT_DAYS = 15  # the vendor will improve payment terms by up to this many days
SNAP = 0.003  # within 0.3% of its reserve the vendor stops haggling and calls it final


def flexibility(bid_id: str) -> float:
    """How far the vendor moves toward our offer each round (0..1), fixed per bid."""
    if bid_id in HERO_FLEX:
        return HERO_FLEX[bid_id]
    return _FLEX[zlib.crc32(bid_id.encode("utf-8")) % len(_FLEX)]


@dataclass(frozen=True)
class VendorReply:
    kind: str  # "accept" | "counter" | "firm"
    price: float
    payment: str
    final: bool


def reply(
    event_direction: str,
    *,
    reserve: float,
    flex: float,
    vendor_price: float,
    vendor_payment: str,
    offer_price: float,
    offer_payment: Optional[str],
    round_no: int,
) -> VendorReply:
    """The vendor's answer to our offer. `round_no` counts replies already given (0 for the first)."""
    mover = deal.opposite(event_direction)  # the vendor's own direction
    if deal.within_limit(mover, offer_price, reserve):
        payment = vendor_payment
        if (offer_payment and deal.better_payment(event_direction, offer_payment, vendor_payment)
                and abs(deal.payment_days(offer_payment) - deal.payment_days(vendor_payment))
                <= GRANT_PAYMENT_DAYS):
            payment = offer_payment
        return VendorReply("accept", offer_price, payment, True)
    moved = deal.concede(mover, vendor_price, offer_price, reserve, flex)
    if abs(moved - reserve) <= SNAP * reserve:
        moved = reserve
        final = True
    else:
        final = moved == vendor_price or round_no + 1 >= MAX_VENDOR_ROUNDS
    return VendorReply("firm" if final else "counter", moved, vendor_payment, final)
```



**File:** `backend/app/negotiation/tactics.py`

```python
"""The buyer-side brain: what to offer next, when to accept and when to hand back to the buyer.

Every price comparison goes through app.deal, so buy and sell share one code path. The rationale
strings are for the buyer only; they may quote internal targets and limits and are never sent.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app import deal
from app.negotiation.messages import money

MAX_ROUNDS = 6
CLOSE_WINDOW = 0.025  # a vendor within 2.5% of our limit gets a closing offer at the limit
FRACTION = 0.4  # share of the distance to the vendor's price we move each round
FRACTION_PAYMENT_FOCUS = 0.25  # move less on price when the buyer's objective is payment terms


@dataclass(frozen=True)
class Context:
    direction: str
    target: float
    limit: float
    objective: Optional[str]
    round: int  # vendor replies so far
    our_offer: Optional[float]
    vendor_offer: float
    previous_vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    original_price: float


@dataclass(frozen=True)
class Decision:
    kind: str  # "offer" | "accept" | "handback"
    message_kind: str  # wording template: "open" | "counter" | "close" | "accept" | ""
    price: Optional[float]
    payment: Optional[str]
    rationale: str


def _limit_word(direction: str) -> str:
    return "ceiling" if direction == "buy" else "floor"


def _payment_ask(ctx: Context, tiers: int) -> Optional[str]:
    code: Optional[str] = ctx.vendor_payment
    asked = None
    for _ in range(tiers):
        code = deal.next_better_payment(ctx.direction, code) if code else None
        if code is None:
            break
        asked = code
    return asked


def opening(ctx: Context) -> Decision:
    price = deal.round_price(ctx.target)
    ask = _payment_ask(ctx, 2 if ctx.objective == "improve_payment_terms" else 0)
    return Decision(
        "offer", "open", price, ask,
        f"Open at your target of {money(price)}. The vendor quoted {money(ctx.vendor_offer)}, so "
        f"this leaves room to move toward your {_limit_word(ctx.direction)} of {money(ctx.limit)}.")


def respond(ctx: Context) -> Decision:
    """Decide the next move after the vendor's latest reply."""
    d, v = ctx.direction, ctx.vendor_offer
    inside = deal.within_limit(d, v, ctx.limit)
    word = _limit_word(d)
    if inside and (ctx.round >= 3 or ctx.vendor_final or deal.gap_to_target(d, v, ctx.target) == 0):
        return Decision(
            "accept", "accept", v, ctx.vendor_payment,
            f"{money(v)} is within your {word} of {money(ctx.limit)}. I recommend accepting.")
    if not inside:
        stalled = ctx.round >= 2 and v == ctx.previous_vendor_offer
        if ctx.vendor_final or ctx.round >= MAX_ROUNDS or stalled or ctx.our_offer == ctx.limit:
            return Decision(
                "handback", "", None, None,
                f"The vendor is at {money(v)}, outside your {word} of {money(ctx.limit)}, and is not "
                "moving further. I recommend handing this back to you to decide.")
        if abs(v - ctx.limit) / ctx.limit <= CLOSE_WINDOW:
            ask = _payment_ask(ctx, 1)
            more = f" with payment in {deal.payment_days(ask)} days" if ask else ""
            return Decision(
                "offer", "close", ctx.limit, ask,
                f"The vendor is at {money(v)}, only {money(abs(v - ctx.limit))} outside your {word}. "
                f"I recommend asking {money(ctx.limit)}{more} to close.")
    fraction = FRACTION_PAYMENT_FOCUS if ctx.objective == "improve_payment_terms" else FRACTION
    nxt = deal.concede(d, ctx.our_offer if ctx.our_offer is not None else ctx.target, v, ctx.limit, fraction)
    ask = _payment_ask(ctx, 1) if ctx.objective == "improve_payment_terms" else None
    moved = abs(v - ctx.previous_vendor_offer)
    return Decision(
        "offer", "counter", nxt, ask,
        f"The vendor moved {money(moved)} to {money(v)}. "
        + (f"That is still {money(abs(v - ctx.limit))} outside your {word}. " if not inside
           else f"That is already within your {word}, but {money(deal.gap_to_target(d, v, ctx.target))} "
                "short of your target. ")
        + f"I recommend asking {money(nxt)}.")
```


- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_negotiation_engine.py -q -p no:asyncio` then the full suite.
Expected: 49 new tests pass; nothing else regresses.

- [ ] **Step 5: Commit**

```bash
git add backend/app/negotiation backend/tests/test_negotiation_engine.py
git commit -m "Add the message wording in three languages, the outgoing-message guardrails, the rule-based vendor and the buyer tactics."
```

---

### Task 4: Negotiation sessions (modes, drafts, take-over, result, approval)

**Files:**
- Create: `backend/app/negotiation/service.py`, `backend/tests/test_negotiation_service.py`

**Interfaces:**
- Consumes: Tasks 1 to 3, `app.services.Conflict/NotFound`, `app.lifecycle`.
- Produces (all take `repo` first and run inside one transaction): `start(repo, item_id, *, vendor_id=None, mode="approve") -> Session`; `advance(repo, session_id) -> Session`; `approve_draft(repo, session_id, draft_id, *, price=None, payment_code=None, text=None)`; `discard_draft`; `send_message(repo, session_id, *, price, payment_code=None, text=None)`; `accept_offer(repo, session_id)`; `hand_back(repo, session_id, reason=None)`; `set_mode(repo, session_id, mode)`; `continue_negotiation(repo, item_id)`; `accept_deal(repo, item_id) -> Item`; `approve_event(repo, event_id) -> list[Outcome]`; readers `sessions_for_item`, `turns`, `pending_draft`.
- Item states driven: `analyzed -> negotiating` (start), `negotiating -> result_pending` (agreed), `negotiating|result_pending -> handed_back`, `result_pending -> negotiating` (continue), `result_pending|analyzed -> awaiting_approval` (accept), `awaiting_approval -> closed` (approve, with an `Outcome`).

- [ ] **Step 1: Write the failing tests**


**File:** `backend/tests/test_negotiation_service.py`

```python
import pytest

from app import deal, lifecycle, readmodel, services
from app.negotiation import guardrails
from app.negotiation import service as neg
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


def test_start_picks_the_best_effective_vendor_or_the_one_named(buy: Repo):
    s = neg.start(buy, BUY)
    comp = readmodel.comparison(readmodel.snapshot(buy), buy.get("item", BUY))
    assert s.vendor_id == comp.rows[0].vendor_id


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
    assert [(t.speaker, t.price) for t in ts] == [("us", 250), ("vendor", 275), ("us", 270), ("vendor", 270)]
    assert [t.author for t in ts] == ["bot", "vendor", "bot", "vendor"]
    assert deal.realised_delta("buy", s.original_price, s.agreed_price, 600) == 9000


def test_full_auto_hero_sell_ends_at_168(sell: Repo):
    s = run_auto(sell, neg.start(sell, SELL, mode="auto").id)
    assert s.status == "agreed" and s.agreed_price == 168
    assert deal.realised_delta("sell", s.original_price, s.agreed_price, 5000) == 25000


def test_nothing_the_vendor_sees_reveals_software_or_internal_numbers(buy: Repo):
    s = run_auto(buy, neg.start(buy, BUY, mode="auto").id)
    for t in neg.turns(buy, s.id):
        if t.speaker == "us":
            guardrails.check_message(t.text, offer_price=t.price, limit=270, target=250)
            assert "Dhruvil Patel" in t.text
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
    assert [t.speaker for t in ts] == ["us", "vendor"] and ts[0].author == "bot" and ts[1].price == 275

    neg.advance(buy, s.id)
    d2 = neg.pending_draft(buy, s.id)
    assert d2.price == 270 and d2.payment_code == "ZD45"
    s = neg.approve_draft(buy, s.id, d2.id, price=269)  # the buyer edits the price
    assert s.status == "agreed" and s.agreed_price == 269
    assert [t.author for t in neg.turns(buy, s.id)][2] == "human"


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
    s = neg.send_message(buy, s.id, price=270)
    assert s.status == "agreed" and s.agreed_price == 270
    assert [t.author for t in neg.turns(buy, s.id)] == ["bot", "vendor", "human", "vendor"]


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
    made = neg.approve_event(buy, "EVT-2026-041")
    assert len(made) == 1
    o = buy.get("outcome", BUY)
    assert (o.original_price, o.final_price, o.negotiated, o.payment_code) == (285, 270, True, "ZD45")
    assert o.duration_minutes >= 1 and item_state(buy, BUY) == "closed"

    after = readmodel.dashboard(readmodel.snapshot(buy)).kpis
    assert after.completed_negotiations == before.completed_negotiations + 1
    assert after.realised_savings == round(before.realised_savings + 9000, 2)


def test_the_best_quote_can_be_accepted_as_it_stands(buy: Repo):
    assert neg.accept_deal(buy, BUY).state == "awaiting_approval"
    neg.approve_event(buy, "EVT-2026-041")
    o = buy.get("outcome", BUY)
    assert (o.original_price, o.final_price, o.negotiated, o.duration_minutes) == (285, 285, False, 0)


def test_approval_needs_something_awaiting_and_a_result_to_accept(buy: Repo):
    with pytest.raises(services.Conflict):
        neg.approve_event(buy, "EVT-2026-041")
    with pytest.raises(services.Conflict):
        neg.continue_negotiation(buy, BUY)
    s = neg.start(buy, BUY, mode="manual")
    with pytest.raises(lifecycle.InvalidTransition):
        neg.accept_deal(buy, "EVT-2026-041-02")        # a draft item cannot be accepted
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
```


- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_negotiation_service.py -q -p no:asyncio`
Expected: FAIL (`ImportError: cannot import name 'service'`).

- [ ] **Step 3: Implement**


**File:** `backend/app/negotiation/service.py`

```python
"""Negotiation sessions: start, advance in the chosen permission mode, approve or edit drafts,
take over by hand, accept, hand back, and close with an outcome.

Permission modes (switchable at any time):
  auto     the assistant plays a full round each time `advance` is called
  approve  it prepares each move as a draft; the buyer approves, edits or discards it
  manual   it does nothing on its own; the buyer writes every message
Every outgoing offer and message passes the guardrails in every mode.
"""
from __future__ import annotations

import math
from typing import Optional

from app import clock, deal, lifecycle
from app.models import Bid, Draft, Event, Item, Mode, Outcome, Session, Turn
from app.negotiation import guardrails, messages, tactics, vendor_sim
from app.services import Conflict, NotFound
from app.store import Repo


# --- lookups ---------------------------------------------------------------------------------

def _get(repo: Repo, kind: str, id: str, label: str):
    obj = repo.get(kind, id)
    if obj is None:
        raise NotFound(f"{label} {id} not found")
    return obj


def _item(repo: Repo, item_id: str) -> Item:
    return _get(repo, "item", item_id, "item")


def _event(repo: Repo, item: Item) -> Event:
    return _get(repo, "event", item.event_id, "event")


def _session(repo: Repo, session_id: str) -> Session:
    return _get(repo, "session", session_id, "session")


def _points(item: Item) -> tuple[float, float]:
    return (item.target if item.target is not None else item.suggested_target,
            item.limit if item.limit is not None else item.suggested_limit)


def _bid(repo: Repo, session: Session) -> Bid:
    return _get(repo, "bid", session.bid_id, "bid")


def sessions_for_item(repo: Repo, item_id: str) -> list[Session]:
    return repo.fetch("session", parent=item_id)


def turns(repo: Repo, session_id: str) -> list[Turn]:
    return sorted(repo.fetch("turn", parent=session_id), key=lambda t: t.seq)


def pending_draft(repo: Repo, session_id: str) -> Optional[Draft]:
    pending = [d for d in repo.fetch("draft", parent=session_id) if d.status == "pending"]
    return pending[-1] if pending else None


def _save_session(repo: Repo, s: Session) -> Session:
    repo.put("session", s.id, s, parent=s.item_id)
    return s


def _move_item(repo: Repo, item: Item, new_state: str) -> Item:
    lifecycle.require_transition(item.state, new_state)
    item = item.model_copy(update={"state": new_state})
    repo.put("item", item.id, item, parent=item.event_id)
    return item


def _add_turn(repo: Repo, s: Session, speaker: str, author: str, text: str,
              price: Optional[float], payment: Optional[str]) -> Turn:
    seq = len(repo.fetch("turn", parent=s.id)) + 1
    t = Turn(id=f"{s.id}-T{seq:02d}", session_id=s.id, seq=seq, speaker=speaker, author=author,
             text=text, price=price, payment_code=payment, at=clock.now())
    repo.put("turn", t.id, t, parent=s.id)
    return t


def _context(s: Session, item: Item, event: Event) -> tactics.Context:
    target, limit = _points(item)
    return tactics.Context(
        direction=event.direction, target=target, limit=limit, objective=item.objective,
        round=s.round, our_offer=s.our_offer, vendor_offer=s.vendor_offer,
        previous_vendor_offer=s.previous_vendor_offer, vendor_payment=s.vendor_payment,
        vendor_final=s.vendor_final, original_price=s.original_price)


def _our_text(kind: str, s: Session, item: Item, event: Event, vendor_name: str, price: float,
              payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None) -> str:
    return messages.our_message(
        kind, direction=event.direction, lang=s.language, vendor_name=vendor_name,
        item=item.description, qty=item.qty, unit=item.unit, quote=s.vendor_offer, price=price,
        payment_ask=payment_ask, agreed_payment=agreed_payment)


def _vendor_name(repo: Repo, s: Session) -> str:
    v = repo.get("vendor", s.vendor_id)
    return v.name if v else s.vendor_id


def _require_active(s: Session) -> None:
    if s.status != "active":
        raise Conflict(f"this negotiation is {s.status.replace('_', ' ')}")


# --- start -----------------------------------------------------------------------------------

def start(repo: Repo, item_id: str, *, vendor_id: Optional[str] = None, mode: Mode = "approve") -> Session:
    """The buyer starts a negotiation. It never starts on its own."""
    with repo.transaction():
        item = _item(repo, item_id)
        event = _event(repo, item)
        existing = sessions_for_item(repo, item_id)
        if item.state == "analyzed":
            item = _move_item(repo, item, "negotiating")
        elif item.state == "negotiating" and not any(x.status in ("active", "agreed") for x in existing):
            pass  # a seeded item that is already marked as negotiating but has no conversation yet
        else:
            raise Conflict("a negotiation can only start after the quotes are analysed")
        bids = repo.fetch("bid", parent=item_id)
        if not bids:
            raise Conflict("there are no quotes to negotiate on")
        if vendor_id is not None:
            chosen = next((b for b in bids if b.vendor_id == vendor_id), None)
            if chosen is None:
                raise Conflict(f"{vendor_id} has not quoted on this item")
        else:
            chosen = deal.best_first(event.direction, bids, key=lambda b: deal.effective_price(
                event.direction, b.unit_price, payment_code=b.payment_code, incoterm=b.incoterm,
                delivery_days=b.delivery_days, warranty_months=b.warranty_months))[0]
        s = Session(
            id=f"S-{item_id}-{len(existing) + 1}", item_id=item_id, vendor_id=chosen.vendor_id,
            bid_id=chosen.id, mode=mode, status="active", language=chosen.language, round=0,
            original_price=chosen.unit_price, original_payment=chosen.payment_code,
            our_offer=None, our_payment=None, vendor_offer=chosen.unit_price,
            previous_vendor_offer=chosen.unit_price, vendor_payment=chosen.payment_code,
            vendor_final=False, agreed_price=None, agreed_payment=None, handback_reason=None,
            started_at=clock.now(), ended_at=None)
        return _save_session(repo, s)


# --- executing moves -------------------------------------------------------------------------

def _finish(repo: Repo, s: Session, item: Item, *, agreed: bool, price: Optional[float] = None,
            payment: Optional[str] = None, reason: Optional[str] = None) -> Session:
    s = s.model_copy(update={
        "status": "agreed" if agreed else "handed_back", "agreed_price": price if agreed else None,
        "agreed_payment": payment if agreed else None, "handback_reason": reason,
        "ended_at": clock.now()})
    _move_item(repo, item, "result_pending" if agreed else "handed_back")
    for d in repo.fetch("draft", parent=s.id):
        if d.status == "pending":
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
    return _save_session(repo, s)


def _send_offer(repo: Repo, s: Session, price: float, payment: Optional[str], text: Optional[str],
                author: str) -> Session:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    target, limit = _points(item)
    price = deal.round_price(price)
    try:
        guardrails.check_offer(event.direction, price, limit)
        if payment:
            deal.payment_days(payment)
        vendor_name = _vendor_name(repo, s)
        if text is None:
            kind = "open" if s.our_offer is None else "counter"
            text = _our_text(kind, s, item, event, vendor_name, price, payment_ask=payment)
        guardrails.check_message(text, offer_price=price, limit=limit, target=target)
    except (guardrails.GuardrailError, ValueError) as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, price, payment)
    reserve = repo.get("reserve", s.bid_id)
    reply = vendor_sim.reply(
        event.direction, reserve=reserve, flex=vendor_sim.flexibility(s.bid_id),
        vendor_price=s.vendor_offer, vendor_payment=s.vendor_payment, offer_price=price,
        offer_payment=payment, round_no=s.round)
    changed_payment = reply.payment if reply.payment != s.vendor_payment else None
    _add_turn(repo, s, "vendor", "vendor", messages.vendor_message(
        reply.kind, direction=event.direction, lang=s.language, price=reply.price,
        unit=item.unit, payment=changed_payment), reply.price, reply.payment)
    s = s.model_copy(update={
        "our_offer": price, "our_payment": payment, "round": s.round + 1,
        "previous_vendor_offer": s.vendor_offer, "vendor_offer": reply.price,
        "vendor_payment": reply.payment, "vendor_final": reply.final})
    if reply.kind == "accept":
        return _finish(repo, s, item, agreed=True, price=price, payment=reply.payment)
    return _save_session(repo, s)


def _accept(repo: Repo, s: Session, text: Optional[str], author: str) -> Session:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    target, limit = _points(item)
    try:
        guardrails.check_offer(event.direction, s.vendor_offer, limit)
        if text is None:
            text = _our_text("accept", s, item, event, _vendor_name(repo, s), s.vendor_offer,
                             agreed_payment=s.vendor_payment)
        guardrails.check_message(text, offer_price=s.vendor_offer, limit=limit, target=target)
    except guardrails.GuardrailError as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, s.vendor_offer, s.vendor_payment)
    return _finish(repo, s, item, agreed=True, price=s.vendor_offer, payment=s.vendor_payment)


def _hand_back(repo: Repo, s: Session, reason: str) -> Session:
    return _finish(repo, s, _item(repo, s.item_id), agreed=False, reason=reason)


# --- drafts and modes ------------------------------------------------------------------------

def _prepare_draft(repo: Repo, s: Session) -> Draft:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    ctx = _context(s, item, event)
    decision = tactics.opening(ctx) if s.our_offer is None else tactics.respond(ctx)
    text = ""
    if decision.kind == "offer":
        text = _our_text(decision.message_kind, s, item, event, _vendor_name(repo, s),
                         decision.price, payment_ask=decision.payment)
    elif decision.kind == "accept":
        text = _our_text("accept", s, item, event, _vendor_name(repo, s), decision.price,
                         agreed_payment=decision.payment)
    n = len(repo.fetch("draft", parent=s.id)) + 1
    d = Draft(id=f"{s.id}-D{n:02d}", session_id=s.id, kind=decision.kind, price=decision.price,
              payment_code=decision.payment, text=text, rationale=decision.rationale,
              created=clock.now(), status="pending")
    repo.put("draft", d.id, d, parent=s.id)
    return d


def _execute(repo: Repo, s: Session, d: Draft, *, price: Optional[float] = None,
             payment: Optional[str] = None, text: Optional[str] = None) -> Session:
    edited = ((price is not None and price != d.price) or (text is not None and text != d.text)
              or (payment is not None and payment != d.payment_code))
    author = "human" if edited else "bot"
    repo.put("draft", d.id, d.model_copy(update={"status": "sent"}), parent=s.id)
    if d.kind == "offer":
        rewording = (price is not None and price != d.price) or (payment is not None and payment != d.payment_code)
        return _send_offer(repo, s, price if price is not None else d.price,
                           payment if payment is not None else d.payment_code,
                           text if text is not None else (None if rewording else d.text), author)
    if d.kind == "accept":
        return _accept(repo, s, text if text is not None else d.text, author)
    return _hand_back(repo, s, d.rationale)


def advance(repo: Repo, session_id: str) -> Session:
    """Do the next step the current mode allows. Safe to call repeatedly."""
    with repo.transaction():
        s = _session(repo, session_id)
        if s.status != "active" or s.mode == "manual":
            return s
        d = pending_draft(repo, s.id)
        if d is None:
            d = _prepare_draft(repo, s)
        if s.mode == "auto":
            return _execute(repo, s, d)
        return s  # approve mode: wait for the buyer


def approve_draft(repo: Repo, session_id: str, draft_id: str, *, price: Optional[float] = None,
                  payment_code: Optional[str] = None, text: Optional[str] = None) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        d = _get(repo, "draft", draft_id, "draft")
        if d.session_id != s.id or d.status != "pending":
            raise Conflict("that draft is no longer waiting for approval")
        return _execute(repo, s, d, price=price, payment=payment_code, text=text)


def discard_draft(repo: Repo, session_id: str, draft_id: str) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        d = _get(repo, "draft", draft_id, "draft")
        if d.session_id != s.id or d.status != "pending":
            raise Conflict("that draft is no longer waiting for approval")
        repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
        return s


def send_message(repo: Repo, session_id: str, *, price: float, payment_code: Optional[str] = None,
                 text: Optional[str] = None) -> Session:
    """The buyer writes the next move by hand (any mode; a pending draft is discarded)."""
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        d = pending_draft(repo, s.id)
        if d is not None:
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
        return _send_offer(repo, s, price, payment_code, text, "human")


def accept_offer(repo: Repo, session_id: str) -> Session:
    """The buyer accepts the vendor's current offer."""
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _accept(repo, s, None, "human")


def hand_back(repo: Repo, session_id: str, reason: Optional[str] = None) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _hand_back(repo, s, reason or "You took this back to decide yourself.")


def set_mode(repo: Repo, session_id: str, mode: Mode) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _save_session(repo, s.model_copy(update={"mode": mode}))


# --- result, approval and closing ------------------------------------------------------------

def _latest_session(repo: Repo, item_id: str) -> Optional[Session]:
    all_ = sessions_for_item(repo, item_id)
    return all_[-1] if all_ else None


def continue_negotiation(repo: Repo, item_id: str) -> Session:
    """From the result screen: keep negotiating the same conversation."""
    with repo.transaction():
        item = _item(repo, item_id)
        s = _latest_session(repo, item_id)
        if s is None or s.status != "agreed":
            raise Conflict("there is no agreed result to continue from")
        _move_item(repo, item, "negotiating")
        return _save_session(repo, s.model_copy(update={
            "status": "active", "agreed_price": None, "agreed_payment": None, "ended_at": None}))


def accept_deal(repo: Repo, item_id: str) -> Item:
    """The buyer accepts a negotiated result, or the best quote as it stands, for approval."""
    with repo.transaction():
        item = _item(repo, item_id)
        if item.state == "result_pending":
            s = _latest_session(repo, item_id)
            if s is None or s.status != "agreed":
                raise Conflict("there is no agreed result to accept")
        return _move_item(repo, item, "awaiting_approval")


def approve_event(repo: Repo, event_id: str) -> list[Outcome]:
    """Approve and close every item of the event that is awaiting approval, recording outcomes."""
    with repo.transaction():
        event = _get(repo, "event", event_id, "event")
        awaiting = [i for i in repo.fetch("item", parent=event_id) if i.state == "awaiting_approval"]
        if not awaiting:
            raise Conflict("nothing in this event is waiting for approval")
        made = []
        for item in awaiting:
            _, limit = _points(item)
            s = _latest_session(repo, item.id)
            bids = repo.fetch("bid", parent=item.id)
            if s is not None and s.status == "agreed":
                bid = _bid(repo, s)
                if not deal.within_limit(event.direction, s.agreed_price, limit):
                    raise Conflict("the agreed price is outside your limit and cannot be approved")
                minutes = max(1, math.ceil((s.ended_at - s.started_at).total_seconds() / 60))
                outcome = Outcome(
                    item_id=item.id, vendor_id=s.vendor_id, direction=event.direction, qty=item.qty,
                    original_price=s.original_price, final_price=s.agreed_price, negotiated=True,
                    payment_code=s.agreed_payment or s.vendor_payment, incoterm=bid.incoterm,
                    closed_date=clock.now().date(), duration_minutes=minutes)
            else:
                if not bids:
                    raise Conflict(f"{item.id} has no quotes to accept")
                best = deal.best_first(event.direction, bids, key=lambda b: b.unit_price)[0]
                outcome = Outcome(
                    item_id=item.id, vendor_id=best.vendor_id, direction=event.direction,
                    qty=item.qty, original_price=best.unit_price, final_price=best.unit_price,
                    negotiated=False, payment_code=best.payment_code, incoterm=best.incoterm,
                    closed_date=clock.now().date(), duration_minutes=0)
            repo.put("outcome", item.id, outcome, parent=item.id)
            _move_item(repo, item, "closed")
            made.append(outcome)
        return made
```


- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_negotiation_service.py -q -p no:asyncio` then the full suite.
Expected: 21 new tests pass, including the sweep over every analyzed seed item.

- [ ] **Step 5: Commit**

```bash
git add backend/app/negotiation/service.py backend/tests/test_negotiation_service.py
git commit -m "Add negotiation sessions with three permission modes, drafts, take-over, hand-back, result acceptance and approval."
```

---

### Task 5: Session views and API routes

**Files:**
- Create: `backend/app/negotiation/views.py`, `backend/tests/test_negotiation_api.py`
- Modify: `backend/app/schemas.py`, `backend/app/api.py`, `assumptions.txt`
- Generate: `backend/openapi.json`, `frontend/lib/api-types.ts`

**Interfaces:**
- Produces schemas `TurnView, DraftView, Intelligence, SessionSummary, SessionView`; `views.session_view(repo, id)`, `views.summaries_for_item(repo, item_id)`; routes:
  `GET /api/items/{id}/sessions`, `POST /api/items/{id}/negotiations` (body `{vendor_id?, mode}`), `GET /api/sessions/{id}`, `PUT /api/sessions/{id}/mode`, `POST /api/sessions/{id}/advance`, `POST /api/sessions/{id}/drafts/{draft_id}/approve` (optional body `{price?, payment_code?, text?}`), `POST /api/sessions/{id}/drafts/{draft_id}/discard`, `POST /api/sessions/{id}/messages`, `POST /api/sessions/{id}/accept-offer`, `POST /api/sessions/{id}/hand-back`, `POST /api/items/{id}/continue`, `POST /api/items/{id}/accept-deal`, `POST /api/events/{id}/approve`.
- Errors: guardrail and rule violations 409, unknown ids 404, bad bodies 422 (price must be positive and finite).

- [ ] **Step 1: Write the failing tests**


**File:** `backend/tests/test_negotiation_api.py`

```python
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
    assert s["intelligence"]["latest_vendor_offer"] == 275 and s["intelligence"]["movement"] == 10

    s = client.post(f"/api/sessions/{sid}/advance").json()
    d = s["pending_draft"]
    s = client.post(f"/api/sessions/{sid}/drafts/{d['id']}/approve", json={}).json()
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
    s = client.post(f"/api/sessions/{sid}/messages", json={"price": 270}).json()
    assert s["status"] == "agreed" and [t["author"] for t in s["turns"]][2] == "human"


def test_full_auto_sell_hero_reaches_168(client):
    analyzed(client, SELL, 170, 165)
    sid = start(client, SELL, "auto")["id"]
    for _ in range(8):
        s = client.post(f"/api/sessions/{sid}/advance").json()
        if s["status"] != "active":
            break
    assert s["status"] == "agreed" and s["agreed_price"] == 168 and s["agreed_delta"] == 25000


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
```


- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_negotiation_api.py -q -p no:asyncio`
Expected: FAIL (404 for the new routes).

- [ ] **Step 3: Implement**


**File:** `backend/app/negotiation/views.py`

```python
"""Session views for the API. The vendor's reserve and flexibility are never part of these."""
from __future__ import annotations

from typing import Optional

from app import deal
from app import schemas as sch
from app.models import Draft, Session, Turn
from app.negotiation import service
from app.negotiation.messages import money
from app.services import NotFound
from app.store import Repo


def _vendor_name(repo: Repo, vendor_id: str) -> str:
    v = repo.get("vendor", vendor_id)
    return v.name if v else vendor_id


def summary(repo: Repo, s: Session) -> sch.SessionSummary:
    return sch.SessionSummary(
        id=s.id, item_id=s.item_id, vendor_id=s.vendor_id, vendor_name=_vendor_name(repo, s.vendor_id),
        mode=s.mode, status=s.status, round=s.round, started_at=s.started_at,
        agreed_price=s.agreed_price)


def _turn(t: Turn) -> sch.TurnView:
    return sch.TurnView(seq=t.seq, speaker=t.speaker, author=t.author, text=t.text, price=t.price,
                        payment_code=t.payment_code, at=t.at)


def _draft(d: Draft) -> sch.DraftView:
    return sch.DraftView(id=d.id, kind=d.kind, price=d.price, payment_code=d.payment_code,
                         text=d.text, rationale=d.rationale, created=d.created)


def _recommendation(s: Session, draft: Optional[Draft], limit_word: str) -> str:
    if draft is not None:
        return draft.rationale
    if s.status == "agreed":
        return (f"The vendor agreed at {money(s.agreed_price)}. Review the result, then accept it "
                "or keep negotiating.")
    if s.status == "handed_back":
        return s.handback_reason or "This negotiation was handed back to you."
    if s.mode == "manual":
        return "You are writing the messages. Nothing is sent unless you send it."
    if s.mode == "auto":
        return "Running automatically. You can stop and take over at any time."
    return "Ready to prepare the next move for your approval."


def session_view(repo: Repo, session_id: str) -> sch.SessionView:
    s = repo.get("session", session_id)
    if s is None:
        raise NotFound(f"session {session_id} not found")
    item = repo.get("item", s.item_id)
    event = repo.get("event", item.event_id)
    d = event.direction
    target = item.target if item.target is not None else item.suggested_target
    limit = item.limit if item.limit is not None else item.suggested_limit
    draft = service.pending_draft(repo, s.id)
    inside = deal.within_limit(d, s.vendor_offer, limit)
    intelligence = sch.Intelligence(
        current_bid=s.original_price, target=target, limit=limit, latest_vendor_offer=s.vendor_offer,
        our_offer=s.our_offer,
        movement=round(deal.realised_delta(d, s.original_price, s.vendor_offer, 1), 2),
        potential_delta=deal.potential_delta(d, s.vendor_offer, target, item.qty),
        delta_if_accepted=(deal.realised_delta(d, s.original_price, s.vendor_offer, item.qty)
                           if inside else None),
        within_limit=inside,
        recommendation=_recommendation(s, draft, "ceiling" if d == "buy" else "floor"))
    base = summary(repo, s).model_dump()
    return sch.SessionView(
        **base, item_description=item.description, direction=d, language=s.language, unit=item.unit,
        qty=item.qty, original_price=s.original_price, our_offer=s.our_offer,
        vendor_offer=s.vendor_offer, vendor_payment=s.vendor_payment, vendor_final=s.vendor_final,
        agreed_payment=s.agreed_payment,
        agreed_delta=(deal.realised_delta(d, s.original_price, s.agreed_price, item.qty)
                      if s.agreed_price is not None else None),
        handback_reason=s.handback_reason, ended_at=s.ended_at,
        turns=[_turn(t) for t in service.turns(repo, s.id)],
        pending_draft=_draft(draft) if draft else None, intelligence=intelligence)


def summaries_for_item(repo: Repo, item_id: str) -> list[sch.SessionSummary]:
    return [summary(repo, s) for s in service.sessions_for_item(repo, item_id)]
```


In `backend/app/schemas.py` change `from datetime import date` to `from datetime import date, datetime`, change the models import line to
`from app.models import Direction, DraftKind, ItemState, Language, Mode, Objective, SessionStatus, Unit`
and append at the end of the file:


```python
# --- negotiation sessions ------------------------------------------------------------------

class TurnView(BaseModel):
    seq: int
    speaker: Literal["us", "vendor"]
    author: Literal["bot", "human", "vendor"]  # for the buyer's own audit trail
    text: str
    price: Optional[float]
    payment_code: Optional[str]
    at: datetime


class DraftView(BaseModel):
    id: str
    kind: DraftKind
    price: Optional[float]
    payment_code: Optional[str]
    text: str
    rationale: str  # shown to the buyer only
    created: datetime


class Intelligence(BaseModel):
    current_bid: float
    target: float
    limit: float
    latest_vendor_offer: float
    our_offer: Optional[float]
    movement: float  # improvement per unit since the vendor's opening quote
    potential_delta: float
    delta_if_accepted: Optional[float]
    within_limit: bool
    recommendation: str


class SessionSummary(BaseModel):
    id: str
    item_id: str
    vendor_id: str
    vendor_name: str
    mode: Mode
    status: SessionStatus
    round: int
    started_at: datetime
    agreed_price: Optional[float]


class SessionView(SessionSummary):
    item_description: str
    direction: Direction
    language: Language
    unit: Unit
    qty: float
    original_price: float
    our_offer: Optional[float]
    vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    agreed_payment: Optional[str]
    agreed_delta: Optional[float]
    handback_reason: Optional[str]
    ended_at: Optional[datetime]
    turns: list[TurnView]
    pending_draft: Optional[DraftView]
    intelligence: Intelligence
```


In `backend/app/api.py`:

1. Add to the imports: `from pydantic import BaseModel, ConfigDict, Field` (extend the existing pydantic import), `from app.models import Dataset, Direction, Mode, Objective` (add `Mode`), and
```python
from app.negotiation import service as neg
from app.negotiation import views as negviews
```
2. Add these request bodies right after the existing `SimulateIn` class:


```python
class StartIn(BaseModel):
    vendor_id: Optional[str] = None
    mode: Mode = "approve"


class ModeIn(BaseModel):
    mode: Mode


class ApproveDraftIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    price: Optional[float] = Field(default=None, gt=0)
    payment_code: Optional[str] = Field(default=None, max_length=8)
    text: Optional[str] = Field(default=None, max_length=2000)


class MessageIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    price: float = Field(gt=0)
    payment_code: Optional[str] = Field(default=None, max_length=8)
    text: Optional[str] = Field(default=None, max_length=2000)


class HandBackIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)
```


3. Insert these routes inside `create_app`, immediately before its final `return app` line:


```python
    # --- negotiation sessions ----------------------------------------------------------------

    @app.get("/api/items/{item_id}/sessions", response_model=list[sch.SessionSummary])
    def item_sessions(item_id: str):
        detail(item_id)  # 404 for an unknown item
        return negviews.summaries_for_item(repo, item_id)

    @app.post("/api/items/{item_id}/negotiations", response_model=sch.SessionView)
    def start_negotiation(item_id: str, body: StartIn):
        s = neg.start(repo, item_id, vendor_id=body.vendor_id, mode=body.mode)
        return negviews.session_view(repo, s.id)

    @app.get("/api/sessions/{session_id}", response_model=sch.SessionView)
    def get_session(session_id: str):
        return negviews.session_view(repo, session_id)

    @app.put("/api/sessions/{session_id}/mode", response_model=sch.SessionView)
    def set_mode(session_id: str, body: ModeIn):
        neg.set_mode(repo, session_id, body.mode)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/advance", response_model=sch.SessionView)
    def advance(session_id: str):
        neg.advance(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/drafts/{draft_id}/approve", response_model=sch.SessionView)
    def approve_draft(session_id: str, draft_id: str, body: Optional[ApproveDraftIn] = None):
        b = body or ApproveDraftIn()
        neg.approve_draft(repo, session_id, draft_id, price=b.price, payment_code=b.payment_code,
                          text=b.text)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/drafts/{draft_id}/discard", response_model=sch.SessionView)
    def discard_draft(session_id: str, draft_id: str):
        neg.discard_draft(repo, session_id, draft_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/messages", response_model=sch.SessionView)
    def send_message(session_id: str, body: MessageIn):
        neg.send_message(repo, session_id, price=body.price, payment_code=body.payment_code,
                         text=body.text)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/accept-offer", response_model=sch.SessionView)
    def accept_offer(session_id: str):
        neg.accept_offer(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/hand-back", response_model=sch.SessionView)
    def hand_back(session_id: str, body: Optional[HandBackIn] = None):
        neg.hand_back(repo, session_id, (body.reason if body else None))
        return negviews.session_view(repo, session_id)

    @app.post("/api/items/{item_id}/continue", response_model=sch.SessionView)
    def continue_negotiation(item_id: str):
        s = neg.continue_negotiation(repo, item_id)
        return negviews.session_view(repo, s.id)

    @app.post("/api/items/{item_id}/accept-deal", response_model=sch.ItemDetail)
    def accept_deal(item_id: str):
        neg.accept_deal(repo, item_id)
        return detail(item_id)

    @app.post("/api/events/{event_id}/approve", response_model=sch.EventDetail)
    def approve_event(event_id: str):
        neg.approve_event(repo, event_id)
        s = snap()
        return readmodel.event_detail(s, s.event_by_id[event_id])
```


Then regenerate the schema and the frontend types, and run everything:

```bash
python scripts/export_openapi.py
python -m pytest -q -p no:asyncio
cd ../frontend && npm run gen:types && npm run check:types && npx tsc --noEmit
```
Expected: 321 backend tests pass; the type check reports `lib/api-types.ts is up to date`; `tsc` is clean.

- [ ] **Step 4: Record assumptions**

Append to `assumptions.txt` (next numbers after the current last; keep the format):
- Messages to the counterparty are written in a human voice and signed by the buyer; no message says or implies it comes from software. Guardrails enforce this in every mode, including text the buyer types. (User decision. Note for a real deployment: disclosure duties about automated agents differ by market and by counterparty agreement; the POC uses a simulated vendor only.)
- Three permission modes on every session, changeable at any time: full auto, approve each message, manual. Stopping auto and taking over means switching to manual.
- Phase 4 negotiates price and payment terms only; incoterm, delivery or pickup days, warranty, validity and penalty carry over from the vendor's bid. (Narrows assumption 3 for this phase.)
- The simulated vendor is rule-based: a hidden reserve and a fixed flexibility per bid (hash of the bid id; the two hero best-bidders are pinned so the demo story is 270 for the buy and 168 for the sell). It accepts any offer that meets its reserve, may grant up to 15 days better payment, and calls its price final within 0.3% of its reserve or after five replies.
- Buyer tactics: open at the target; move 40% of the way toward the vendor each round (25% when the objective is payment terms); when the vendor is within 2.5% of the limit, ask exactly the limit with one payment tier better; accept an in-limit price after round 3, when the vendor says final, or when it meets the target; otherwise hand back.
- Accepting the best quote as it stands is allowed from `analyzed` and produces a non-negotiated outcome (original equals final, duration 0).
- Sessions, turns and drafts live only in the store and are cleared by Reset. Seeded items that are already `negotiating` or `handed_back` have no conversation; the buyer can start one.

- [ ] **Step 5: Commit**

```bash
git add backend/app/negotiation/views.py backend/app/schemas.py backend/app/api.py backend/tests/test_negotiation_api.py backend/openapi.json frontend/lib/api-types.ts assumptions.txt
git commit -m "Add the session views and API routes for negotiations, and record the negotiation assumptions."
```

---

## Self-Review

- **Spec and user-direction coverage (Phase 4 backend):** buyer-started negotiation (Task 4/5), three permission modes with mid-conversation take-over (Task 4), human-voice messages in English, Hindi and Marathi with software mentions blocked (Task 3), internal numbers never sent (Task 3), rule-based vendor (Task 3), result / continue / accept / approve / close with outcomes feeding the dashboard (Task 4, checked in the API test against the dashboard KPIs), hand-back path (Task 3/4), no reserve in any response (Task 5 test). Not in this plan by design: the supplier consent/OTP story, the workspace, result, approval and closed screens (Phase 4b), export (Phase 5).
- **Placeholder scan:** none; every file is given in full.
- **Type consistency:** `Decision.kind` values `offer|accept|handback` match `DraftKind`; `Mode` and `SessionStatus` are defined once in `models.py` and imported by `schemas.py`; service functions use only `services.Conflict/NotFound` for rule errors and `lifecycle.InvalidTransition` for illegal state moves (both map to 409).
