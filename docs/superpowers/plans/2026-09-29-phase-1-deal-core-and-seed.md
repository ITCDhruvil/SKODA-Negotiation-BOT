# Phase 1: Deal Core, Importer and Seed Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested backend foundation: direction-aware deal maths, eligibility rules, the Open Shopping Cart Report importer, domain models, and a deterministic seed dataset (with hero events) that round-trips through the importer.

**Architecture:** Pure-Python modules under `backend/app/` with no web layer yet. `deal.py` is the only place BUY and SELL differ. The seed generator writes BUY carts in the exact 30-column SAP layout, parses them back with the real importer (round trip), then builds events, items, bids, history and outcomes around them. Output is committed under `backend/data/seed/`.

**Tech Stack:** Python 3.11, pydantic 2, pytest 8. (FastAPI arrives in Phase 2.)

**Spec:** `docs/superpowers/specs/2026-09-29-main-negotiation-bot-design.md`. Assumptions: `assumptions.txt` (cited as A<n>).

## Global Constraints

- All money is INR. Prices below 100 are kept to 2 decimals; prices of 100 or more are whole rupees.
- Anchors (A7, A8, A9): BUY `target <= ceiling < best bid`; SELL `best bid < floor <= target`. "Acceptable" events invert this on purpose (BUY best bid <= ceiling; SELL best bid >= floor). No-deal events have every vendor reserve beyond our limit.
- Direction is `"buy"` or `"sell"`. Never write `if direction == "sell"` outside `app/deal.py` and `app/seed/`.
- Derived values (value, potential delta, realised delta, effective price) are computed by `deal.py` and never stored.
- `Bid.reserve` is the simulated vendor's hidden walk-away price. It must never be exposed by any API or UI.
- Seed is deterministic: `random.Random(SEED)` only, `TODAY = date(2026, 9, 29)`, no wall-clock reads.
- CSV files use cp1252 with a stray-euro-safe `€` (byte 0x80). Header names are whitespace-stripped on read.
- Commit messages: one short plain paragraph, no prefixes, no bullets, no attribution lines.
- Run all commands from `D:\main-negotiation-bot\backend` unless a step says otherwise.

## File Structure

```
backend/
  pyproject.toml
  app/__init__.py
  app/deal.py            direction-aware maths + effective price
  app/eligibility.py     value band and minimum-bids rule
  app/models.py          pydantic domain models + Dataset
  app/importer.py        Open Cart Report parser/renderer (30 columns)
  app/seed/__init__.py
  app/seed/constants.py  SEED, TODAY, EUR_RATE
  app/seed/pricing.py    round_price, step
  app/seed/catalog.py    BUY categories/templates, scrap materials, name lists
  app/seed/vendors.py    build_vendors, pool
  app/seed/carts.py      make_position, make_cart_positions
  app/seed/heroes.py     hand-authored hero BUY/SELL specs
  app/seed/scrap.py      make_lots
  app/seed/history.py    build_history
  app/seed/build.py      build_positions, build_dataset, write_outputs
  scripts/seed.py        CLI: regenerate committed data
  data/seed/dataset.json + open_shopping_cart_report.csv   (generated, committed)
  tests/                 one test file per module
```

---

### Task 1: Backend scaffold

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/tests/test_smoke.py`

**Interfaces:**
- Produces: importable package `app`; `pytest` configured with `pythonpath = ["."]` so tests import `app.*`.

- [ ] **Step 1: Write the smoke test**

```python
# file: backend/tests/test_smoke.py
def test_app_package_imports():
    import app

    assert app.__doc__
```

- [ ] **Step 2: Run it to see it fail**

Run: `python -m pytest tests/test_smoke.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app'`).

- [ ] **Step 3: Create the scaffold**

```toml
# file: backend/pyproject.toml
[project]
name = "negotiation-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["pydantic>=2.10", "fastapi>=0.115", "uvicorn>=0.32"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

```python
# file: backend/app/__init__.py
"""Main negotiation bot backend."""
```

- [ ] **Step 4: Run it to see it pass**

Run: `python -m pytest tests/test_smoke.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/app/__init__.py backend/tests/test_smoke.py
git commit -m "Add the backend package scaffold with pytest configured."
```

---

### Task 2: Deal core maths (direction-aware)

**Files:**
- Create: `backend/app/deal.py`
- Test: `backend/tests/test_deal.py`

**Interfaces:**
- Produces (all in `app.deal`): `Direction = Literal["buy","sell"]`; `value(qty, price) -> float`; `best_price(direction, prices) -> float`; `within_limit(direction, price, limit) -> bool`; `gap_to_target(direction, price, target) -> float`; `potential_delta(direction, price, target, qty) -> float`; `realised_delta(direction, original, final, qty) -> float`; `anchors_valid(direction, target, limit, best_bid) -> bool`.

- [ ] **Step 1: Write the failing tests**

```python
# file: backend/tests/test_deal.py
import pytest

from app import deal


def test_value_is_qty_times_price():
    assert deal.value(600, 285) == 171000.0


def test_best_price_is_min_for_buy_and_max_for_sell():
    assert deal.best_price("buy", [292, 285, 312]) == 285
    assert deal.best_price("sell", [162, 163, 154]) == 163


def test_best_price_rejects_empty():
    with pytest.raises(ValueError):
        deal.best_price("buy", [])


def test_within_limit_buy_is_at_or_below_ceiling():
    assert deal.within_limit("buy", 270, 270)
    assert not deal.within_limit("buy", 271, 270)


def test_within_limit_sell_is_at_or_above_floor():
    assert deal.within_limit("sell", 165, 165)
    assert not deal.within_limit("sell", 164, 165)


def test_gap_and_potential_buy_hero():
    assert deal.gap_to_target("buy", 285, 250) == 35
    assert deal.potential_delta("buy", 285, 250, 600) == 21000


def test_gap_is_zero_once_target_reached():
    assert deal.gap_to_target("buy", 240, 250) == 0
    assert deal.gap_to_target("sell", 175, 170) == 0


def test_gap_and_potential_sell_hero():
    assert deal.gap_to_target("sell", 163, 170) == 7
    assert deal.potential_delta("sell", 163, 170, 5000) == 35000


def test_realised_delta_buy_hero():
    assert deal.realised_delta("buy", 285, 270, 600) == 9000


def test_realised_delta_sell_hero():
    assert deal.realised_delta("sell", 163, 168, 5000) == 25000


def test_realised_delta_negative_when_worse():
    assert deal.realised_delta("buy", 270, 285, 10) == -150
    assert deal.realised_delta("sell", 168, 163, 10) == -50


def test_anchors_valid_buy():
    assert deal.anchors_valid("buy", target=250, limit=270, best_bid=285)
    assert not deal.anchors_valid("buy", target=250, limit=290, best_bid=285)
    assert not deal.anchors_valid("buy", target=280, limit=270, best_bid=285)


def test_anchors_valid_sell():
    assert deal.anchors_valid("sell", target=170, limit=165, best_bid=163)
    assert not deal.anchors_valid("sell", target=170, limit=160, best_bid=163)
    assert not deal.anchors_valid("sell", target=160, limit=165, best_bid=163)


def test_unknown_direction_rejected():
    with pytest.raises(ValueError):
        deal.best_price("swap", [1])
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_deal.py -v`
Expected: FAIL (`ImportError: cannot import name 'deal'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/deal.py
"""Direction-aware deal maths. The only module where BUY and SELL behave differently.

direction "buy": we pay; lower is better; the limit is a ceiling.
direction "sell": we receive; higher is better; the limit is a floor.
"""
from __future__ import annotations

from typing import Literal, Sequence

Direction = Literal["buy", "sell"]


def _check(direction: str) -> None:
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")


def value(qty: float, price: float) -> float:
    return round(qty * price, 2)


def best_price(direction: Direction, prices: Sequence[float]) -> float:
    _check(direction)
    if not prices:
        raise ValueError("no prices")
    return min(prices) if direction == "buy" else max(prices)


def within_limit(direction: Direction, price: float, limit: float) -> bool:
    _check(direction)
    return price <= limit if direction == "buy" else price >= limit


def gap_to_target(direction: Direction, price: float, target: float) -> float:
    """Distance still to travel to reach the target; 0 once the target is met or beaten."""
    _check(direction)
    raw = price - target if direction == "buy" else target - price
    return round(max(0.0, raw), 2)


def potential_delta(direction: Direction, price: float, target: float, qty: float) -> float:
    return round(gap_to_target(direction, price, target) * qty, 2)


def realised_delta(direction: Direction, original: float, final: float, qty: float) -> float:
    """Savings (buy) or uplift (sell); positive means better for us."""
    _check(direction)
    per_unit = original - final if direction == "buy" else final - original
    return round(per_unit * qty, 2)


def anchors_valid(direction: Direction, target: float, limit: float, best_bid: float) -> bool:
    """Normal negotiation start: the best bid is outside our limit (A7, A8)."""
    _check(direction)
    if direction == "buy":
        return target <= limit < best_bid
    return best_bid < limit <= target
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_deal.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/deal.py backend/tests/test_deal.py
git commit -m "Add direction-aware deal maths for value, gap, potential and realised delta, and anchor validation."
```

---

### Task 3: Effective price for mixed-term offers

**Files:**
- Modify: `backend/app/deal.py` (append)
- Modify: `backend/tests/test_deal.py` (append)

**Interfaces:**
- Consumes: Task 2 module.
- Produces: `TermsConfig` (frozen dataclass, defaults carry 12%, warranty 0.2%/month, delay 0.05%/day, freight tables); `DEFAULT_TERMS`; `payment_days(code) -> int`; `effective_price(direction, price, *, payment_code, incoterm, delivery_days, warranty_months=0, cfg=DEFAULT_TERMS) -> float`.

- [ ] **Step 1: Append failing tests**

```python
# file: backend/tests/test_deal.py  (append to the end of the file)
def test_payment_days_parses_codes():
    assert deal.payment_days("ZD30") == 30
    assert deal.payment_days("zd45") == 45
    assert deal.payment_days("ADV") == 0
    assert deal.payment_days("LC") == 0


def test_payment_days_rejects_unknown():
    with pytest.raises(ValueError):
        deal.payment_days("NET30")


def test_effective_price_buy_rewards_credit_and_warranty():
    eff = deal.effective_price(
        "buy", 100, payment_code="ZD30", incoterm="FH", delivery_days=30, warranty_months=12
    )
    assert eff == 98.11


def test_effective_price_buy_charges_freight_for_exw():
    exw = deal.effective_price("buy", 100, payment_code="ADV", incoterm="EXW", delivery_days=0)
    assert exw == 103.0


def test_effective_price_sell_penalises_long_credit():
    adv = deal.effective_price("sell", 100, payment_code="ADV", incoterm="EXW", delivery_days=0)
    zd60 = deal.effective_price("sell", 100, payment_code="ZD60", incoterm="EXW", delivery_days=0)
    assert adv == 100.0
    assert zd60 < adv


def test_effective_price_sell_deducts_freight_and_pickup_delay():
    eff = deal.effective_price("sell", 100, payment_code="ZD30", incoterm="FCA", delivery_days=10)
    assert eff == 98.01  # 99.0137 present value - (0.5% freight + 0.5% delay)


def test_effective_price_rejects_unknown_incoterm():
    with pytest.raises(ValueError):
        deal.effective_price("buy", 100, payment_code="ZD30", incoterm="XYZ", delivery_days=1)
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_deal.py -v`
Expected: new tests FAIL (`AttributeError: module 'app.deal' has no attribute 'payment_days'`).

- [ ] **Step 3: Append implementation**

```python
# file: backend/app/deal.py  (append to the end of the file)
from dataclasses import dataclass, field  # noqa: E402


@dataclass(frozen=True)
class TermsConfig:
    """Illustrative rates (A15). One place to tune."""

    carry_rate: float = 0.12
    warranty_rate_per_month: float = 0.002
    delay_rate_per_day: float = 0.0005
    freight_pct_buy: dict[str, float] = field(
        default_factory=lambda: {"EXW": 0.03, "FCA": 0.02, "FH": 0.0, "DAP": 0.0, "DDP": 0.0}
    )
    freight_pct_sell: dict[str, float] = field(
        default_factory=lambda: {"EXW": 0.0, "FCA": 0.005, "FH": 0.02, "DAP": 0.02, "DDP": 0.03}
    )


DEFAULT_TERMS = TermsConfig()


def payment_days(code: str) -> int:
    c = code.strip().upper()
    if c.startswith("ZD") and c[2:].isdigit():
        return int(c[2:])
    if c in ("ADV", "LC"):
        return 0
    raise ValueError(f"unknown payment code {code!r}")


def effective_price(
    direction: Direction,
    price: float,
    *,
    payment_code: str,
    incoterm: str,
    delivery_days: int,
    warranty_months: int = 0,
    cfg: TermsConfig = DEFAULT_TERMS,
) -> float:
    """Price adjusted for the terms attached to it, so offers with different terms compare.

    Later payment lowers the present value for both directions. The remaining adjustment is a cost
    for us on BUY (freight, delay, less warranty benefit) and a revenue reduction on SELL.
    """
    _check(direction)
    present_value = price * (1 - cfg.carry_rate * payment_days(payment_code) / 365)
    table = cfg.freight_pct_buy if direction == "buy" else cfg.freight_pct_sell
    key = incoterm.strip().upper()
    if key not in table:
        raise ValueError(f"unknown incoterm {incoterm!r}")
    adjustment = price * (
        table[key]
        + cfg.delay_rate_per_day * delivery_days
        - cfg.warranty_rate_per_month * warranty_months
    )
    total = present_value + adjustment if direction == "buy" else present_value - adjustment
    return round(total, 2)
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_deal.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/deal.py backend/tests/test_deal.py
git commit -m "Add the effective price calculation so offers with different payment, freight, delay and warranty terms can be compared."
```

---

### Task 4: Eligibility rules

**Files:**
- Create: `backend/app/eligibility.py`
- Test: `backend/tests/test_eligibility.py`

**Interfaces:**
- Produces: `Band(name, min_value, max_value, min_bids)`; `PHASE_1` (2,000 to 3,50,000, 2 bids); `PHASE_2` (2,000 to 10,00,000, 3 bids); `DEFAULT_BAND = PHASE_2` (A43); `Eligibility(eligible: bool, reason: str)`; `check_value(value, band=DEFAULT_BAND)`; `check_bids(n_bids, band=DEFAULT_BAND)`.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_eligibility.py
from app import eligibility as el


def test_value_inside_band_is_eligible():
    assert el.check_value(318_200).eligible
    assert el.check_value(825_000).eligible


def test_value_edges_are_inclusive():
    assert el.check_value(2_000).eligible
    assert el.check_value(1_000_000).eligible


def test_value_below_min_is_ineligible_with_reason():
    r = el.check_value(1_000)
    assert not r.eligible
    assert "below" in r.reason


def test_value_above_max_is_ineligible_with_reason():
    r = el.check_value(1_100_000)
    assert not r.eligible
    assert "above" in r.reason


def test_phase_1_upper_limit_is_3_5_lakh():
    assert el.check_value(350_000, el.PHASE_1).eligible
    assert not el.check_value(350_001, el.PHASE_1).eligible


def test_min_bids_per_phase():
    assert not el.check_bids(1, el.PHASE_1).eligible
    assert el.check_bids(2, el.PHASE_1).eligible
    assert not el.check_bids(2, el.PHASE_2).eligible
    assert el.check_bids(3, el.PHASE_2).eligible


def test_bids_reason_names_the_minimum():
    assert "3" in el.check_bids(2).reason


def test_default_band_is_phase_2():
    assert el.DEFAULT_BAND is el.PHASE_2
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_eligibility.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/eligibility.py
"""Module 3 eligibility: value band and minimum number of bids (A17, A43)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Band:
    name: str
    min_value: float
    max_value: float
    min_bids: int


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    reason: str = ""


PHASE_1 = Band("phase1", 2_000, 350_000, 2)
PHASE_2 = Band("phase2", 2_000, 1_000_000, 3)
DEFAULT_BAND = PHASE_2


def check_value(value: float, band: Band = DEFAULT_BAND) -> Eligibility:
    if value < band.min_value:
        return Eligibility(False, f"value {value:,.0f} is below the minimum {band.min_value:,.0f}")
    if value > band.max_value:
        return Eligibility(False, f"value {value:,.0f} is above the maximum {band.max_value:,.0f}")
    return Eligibility(True)


def check_bids(n_bids: int, band: Band = DEFAULT_BAND) -> Eligibility:
    if n_bids < band.min_bids:
        return Eligibility(False, f"needs at least {band.min_bids} bids (has {n_bids})")
    return Eligibility(True)
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_eligibility.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/eligibility.py backend/tests/test_eligibility.py
git commit -m "Add eligibility checks for the value band and the minimum number of bids."
```

---

### Task 5: Domain models

**Files:**
- Create: `backend/app/models.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces (pydantic v2, `extra="forbid"`): `Vendor`, `Event`, `Item`, `Bid`, `Outcome`, `HistoryRecord`, `Dataset`. Field lists are in the code below. `Dataset` methods: `event_items(event_id) -> list[Item]`, `item_bids(item_id, scripted=False) -> list[Bid]`, `event_value(event_id) -> float` (sum of qty x reference_price).

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_models.py
from datetime import date

import pytest
from pydantic import ValidationError

from app.models import Bid, Dataset, Event, Item, Vendor


def _event(eid="EVT-2026-001"):
    return Event(
        id=eid, type="shopping_cart", direction="buy", title="t", company_id="0800",
        company="SKODA Auto VW India", plant="Plant Pune", purch_org="LPOS", purch_group="A05",
        category="25200000 - Catering", category_key="25200000", requestor="X", cost_centre="1",
        created=date(2026, 8, 1), approval_date=date(2026, 8, 2), due=date(2026, 9, 1),
        source_cart_no="1", hero=False, acceptable=False, no_deal=False, stage="draft",
    )


def _item(iid, qty, ref):
    return Item(
        id=iid, event_id="EVT-2026-001", position=1, description="d", kind="goods", qty=qty,
        unit="EA", reference_price=ref, suggested_target=1, suggested_limit=2, target=None,
        limit=None, incoterm="FH", delivery_days=5, state="draft",
    )


def test_extra_fields_are_rejected():
    with pytest.raises(ValidationError):
        Vendor(id="V1", name="n", sap_no="1", type="supplier", categories=[], rating=4.0,
               payment_pref="ZD30", past_deals=1, bogus=1)


def test_event_value_sums_qty_times_reference_price():
    ds = Dataset(
        vendors=[], events=[_event()], items=[_item("a", 10, 5.5), _item("b", 2, 100)],
        bids=[], scripted_bids=[], outcomes=[], history=[],
    )
    assert ds.event_value("EVT-2026-001") == 255.0


def test_item_bids_splits_live_and_scripted():
    b1 = Bid(id="b1", item_id="a", vendor_id="V1", unit_price=1, reserve=1, payment_code="ZD30",
             incoterm="FH", delivery_days=1, validity_days=30, warranty_months=0)
    b2 = b1.model_copy(update={"id": "b2"})
    ds = Dataset(vendors=[], events=[], items=[], bids=[b1], scripted_bids=[b2], outcomes=[],
                 history=[])
    assert [b.id for b in ds.item_bids("a")] == ["b1"]
    assert [b.id for b in ds.item_bids("a", scripted=True)] == ["b2"]


def test_dataset_json_round_trip():
    ds = Dataset(vendors=[], events=[_event()], items=[_item("a", 1, 1)], bids=[],
                 scripted_bids=[], outcomes=[], history=[])
    assert Dataset.model_validate_json(ds.model_dump_json()) == ds
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_models.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/models.py
"""Domain models. Bid.reserve is a simulated vendor's hidden walk-away price: never expose it."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

Direction = Literal["buy", "sell"]
Unit = Literal["EA", "AU", "KG", "TON", "LOT"]
Language = Literal["en", "hi", "mr"]
EventStage = Literal["draft", "awaiting_bids", "analyzed", "negotiating", "closed", "handed_back"]
ItemState = Literal[
    "draft", "points_reviewed", "awaiting_bids", "bids_in", "analyzed", "negotiating",
    "result_pending", "awaiting_approval", "closed", "handed_back",
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Vendor(_Model):
    id: str
    name: str
    sap_no: str
    type: Literal["supplier", "scrap_buyer"]
    categories: list[str]
    rating: float
    payment_pref: str
    past_deals: int


class Event(_Model):
    id: str
    type: Literal["shopping_cart", "scrap_sale"]
    direction: Direction
    title: str
    company_id: str
    company: str
    plant: str
    purch_org: str
    purch_group: str
    category: str
    category_key: str
    requestor: str
    cost_centre: str
    created: date
    approval_date: date
    due: date
    source_cart_no: Optional[str]
    hero: bool
    acceptable: bool
    no_deal: bool
    stage: EventStage


class Item(_Model):
    id: str
    event_id: str
    position: int
    description: str
    kind: Literal["service", "goods", "scrap"]
    qty: float
    unit: Unit
    reference_price: float
    suggested_target: float
    suggested_limit: float
    target: Optional[float]
    limit: Optional[float]
    incoterm: str
    delivery_days: int
    state: ItemState


class Bid(_Model):
    id: str
    item_id: str
    vendor_id: str
    unit_price: float
    reserve: float
    payment_code: str
    incoterm: str
    delivery_days: int
    validity_days: int
    warranty_months: int
    penalty_clause: str = ""
    language: Language = "en"


class Outcome(_Model):
    item_id: str
    vendor_id: str
    direction: Direction
    qty: float
    original_price: float
    final_price: float
    closed_date: date
    duration_minutes: int


class HistoryRecord(_Model):
    id: str
    description: str
    category_key: str
    direction: Direction
    vendor_id: str
    unit_price: float
    qty: float
    unit: Unit
    closed_date: date
    negotiated: bool
    original_price: Optional[float]


class Dataset(_Model):
    vendors: list[Vendor]
    events: list[Event]
    items: list[Item]
    bids: list[Bid]
    scripted_bids: list[Bid]
    outcomes: list[Outcome]
    history: list[HistoryRecord]

    def event_items(self, event_id: str) -> list[Item]:
        return [i for i in self.items if i.event_id == event_id]

    def item_bids(self, item_id: str, scripted: bool = False) -> list[Bid]:
        source = self.scripted_bids if scripted else self.bids
        return [b for b in source if b.item_id == item_id]

    def event_value(self, event_id: str) -> float:
        return round(sum(i.qty * i.reference_price for i in self.event_items(event_id)), 2)
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_models.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_models.py
git commit -m "Add the domain models for events, items, vendors, bids, outcomes and history."
```

---

### Task 6: Open Shopping Cart Report importer

**Files:**
- Create: `backend/app/importer.py`
- Test: `backend/tests/test_importer.py`

**Interfaces:**
- Produces: `RAW_HEADERS` (30, original spacing), `COLUMNS` (stripped); `CartPosition` (frozen dataclass, fields in column order, properties `eclass_code`, `eclass_name`, `shifted`, `net_qty`, `net_unit_price`); `RowWarning(row, cart_no, pos, kind, message)`; `ParseResult(positions, warnings)`; `parse_text(text) -> ParseResult`; `parse_report(path) -> ParseResult` (reads cp1252); `render_report(positions) -> str`; `write_report(positions, path)`.
- Date rules (A46): create/delivery dates are `M/D/YYYY`; the approval column is read `D/M/YYYY` first (all five sample rows only make sense that way), falling back to `M/D/YYYY`.

- [ ] **Step 1: Write failing tests (uses the real sample file)**

```python
# file: backend/tests/test_importer.py
from datetime import date
from pathlib import Path

import pytest

from app.importer import COLUMNS, RAW_HEADERS, parse_report, parse_text, render_report

SAMPLE = Path(__file__).resolve().parents[2] / "data" / "samples" / "open_shopping_cart_report.csv"


def test_headers_are_30_and_stripped_names_have_no_padding():
    assert len(RAW_HEADERS) == 30
    assert all(c == c.strip() for c in COLUMNS)


def test_parse_real_sample_positions():
    ps = parse_report(SAMPLE).positions
    assert [p.cart_no for p in ps] == ["1012358189"] * 3 + ["1012360129", "1012360241"]
    assert [p.pos for p in ps] == [1, 2, 3, 1, 1]
    assert [p.inr_value for p in ps] == [26000, 20000, 20000, 35000, 15000]
    assert ps[0].eclass_code == "25200000"
    assert ps[0].eclass_name == "Gastronomie Und Bewirtung (Dienstleistung)"
    assert ps[0].value_type == "CTM (<10k €)"
    assert ps[3].order_for_id == "9790"
    assert ps[4].qty_unit == "EA"


def test_dates_follow_the_column_formats():
    p = parse_report(SAMPLE).positions[0]
    assert p.create_date == date(2025, 4, 1)
    assert p.approval_date == date(2025, 4, 2)  # column is D/M/YYYY (A46)
    assert p.delivery_to == date(2025, 5, 31)


def test_meal_rows_are_flagged_as_shifted_not_silently_fixed():
    r = parse_report(SAMPLE)
    assert [w.kind for w in r.warnings] == ["shifted_qty"] * 3
    first = r.positions[0]
    assert first.qty == 26000 and first.inr_unit_price == 1  # raw values kept
    assert first.net_qty == 1 and first.net_unit_price == 26000


def test_good_rows_produce_no_warnings():
    r = parse_report(SAMPLE)
    assert {w.cart_no for w in r.warnings} == {"1012358189"}


def test_round_trip_is_lossless():
    r1 = parse_report(SAMPLE)
    r2 = parse_text(render_report(r1.positions))
    assert r2.positions == r1.positions


def test_bad_header_raises():
    with pytest.raises(ValueError):
        parse_text("a,b,c\n1,2,3\n")


def test_wrong_column_count_raises():
    header = ",".join(RAW_HEADERS)
    with pytest.raises(ValueError):
        parse_text(header + "\r\n1,2,3\r\n")


def test_value_mismatch_is_warned():
    ps = parse_report(SAMPLE).positions
    bad = ps[4].__class__(**{**ps[4].__dict__, "qty": 3.0})
    r = parse_text(render_report([bad]))
    assert [w.kind for w in r.warnings] == ["value_mismatch"]
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_importer.py -v`
Expected: FAIL (`ImportError`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/importer.py
"""Parser and renderer for the SAP "Open Shopping Cart Report" (30 columns, cp1252)."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

RAW_HEADERS = (
    "Shopping cart", "Shopping cart pos", "SC description", "Company ID ", "Company ",
    "ID Company (order for)", "Company (order for)", "Purchasing organisation",
    "Purchasing group", "Purch group short", "eCl@ss", "SC create date", "SC approval date ",
    "Delivery from", "Delivery to", "Requestor", "Requesting cost centre",
    "Cost center to be charged", "Account assignment", "SC value type", "SC price unit",
    "SC quantity unit en", "SC currency", "Avg. SC ageing ", "SC quantity ",
    "Avg. SC net price per unit in EUR", "SC value in EUR ",
    "Avg. SC net price per unit in currency", "SC value in currency ", "Status",
)
COLUMNS = tuple(h.strip() for h in RAW_HEADERS)


@dataclass(frozen=True)
class CartPosition:
    cart_no: str
    pos: int
    description: str
    company_id: str
    company: str
    order_for_id: str
    order_for: str
    purch_org: str
    purch_group: str
    purch_group_short: str
    eclass: str
    create_date: date
    approval_date: date
    delivery_from: date
    delivery_to: date
    requestor: str
    req_cost_centre: str
    cost_centre: str
    account_assignment: str
    value_type: str
    price_unit: int
    qty_unit: str
    currency: str
    ageing_days: int
    qty: float
    eur_unit_price: float
    eur_value: float
    inr_unit_price: float
    inr_value: float
    status: str

    @property
    def eclass_code(self) -> str:
        return self.eclass.split(" - ", 1)[0].strip()

    @property
    def eclass_name(self) -> str:
        parts = self.eclass.split(" - ", 1)
        return parts[1].strip() if len(parts) == 2 else ""

    @property
    def shifted(self) -> bool:
        """Quantity column holds the money value and unit price collapsed to 1 (the meal rows)."""
        return self.inr_unit_price == 1 and self.inr_value > 1 and self.qty == self.inr_value

    @property
    def net_qty(self) -> float:
        return 1.0 if self.shifted else self.qty

    @property
    def net_unit_price(self) -> float:
        return self.inr_value if self.shifted else self.inr_unit_price


@dataclass(frozen=True)
class RowWarning:
    row: int
    cart_no: str
    pos: int
    kind: str
    message: str


@dataclass(frozen=True)
class ParseResult:
    positions: list[CartPosition]
    warnings: list[RowWarning]


def _num(s: str) -> float:
    s = s.replace(",", "").strip()
    return float(s) if s else 0.0


def _us_date(s: str) -> date:
    return datetime.strptime(s.strip(), "%m/%d/%Y").date()


def _approval_date(s: str) -> date:
    for fmt in ("%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unreadable approval date {s!r}")


def _warnings_for(row: int, p: CartPosition) -> list[RowWarning]:
    out: list[RowWarning] = []

    def add(kind: str, msg: str) -> None:
        out.append(RowWarning(row, p.cart_no, p.pos, kind, msg))

    if p.shifted:
        add("shifted_qty", "quantity column holds the value; treated as qty 1 at the full value")
    elif p.inr_unit_price not in (0, 1) and p.qty > 0:
        if abs(p.qty * p.inr_unit_price - p.inr_value) > max(1.0, 0.01 * p.inr_value):
            add("value_mismatch", "qty x INR unit price differs from INR value")
    if p.approval_date < p.create_date:
        add("date_order", "approval date is before create date")
    return out


def parse_text(text: str) -> ParseResult:
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header is None or tuple(h.strip() for h in header) != COLUMNS:
        raise ValueError("unexpected header: not an Open Shopping Cart Report")
    positions: list[CartPosition] = []
    warnings: list[RowWarning] = []
    cart = ""
    for n, row in enumerate(reader, start=2):
        if not any(c.strip() for c in row):
            continue
        if len(row) != len(COLUMNS):
            raise ValueError(f"row {n}: expected {len(COLUMNS)} columns, got {len(row)}")
        c = dict(zip(COLUMNS, (x.strip() for x in row)))
        if c["Shopping cart"]:
            cart = c["Shopping cart"]
        p = CartPosition(
            cart_no=cart,
            pos=int(_num(c["Shopping cart pos"])),
            description=c["SC description"],
            company_id=c["Company ID"],
            company=c["Company"],
            order_for_id=c["ID Company (order for)"],
            order_for=c["Company (order for)"],
            purch_org=c["Purchasing organisation"],
            purch_group=c["Purchasing group"],
            purch_group_short=c["Purch group short"],
            eclass=c["eCl@ss"],
            create_date=_us_date(c["SC create date"]),
            approval_date=_approval_date(c["SC approval date"]),
            delivery_from=_us_date(c["Delivery from"]),
            delivery_to=_us_date(c["Delivery to"]),
            requestor=c["Requestor"],
            req_cost_centre=c["Requesting cost centre"],
            cost_centre=c["Cost center to be charged"],
            account_assignment=c["Account assignment"],
            value_type=c["SC value type"],
            price_unit=int(_num(c["SC price unit"])),
            qty_unit=c["SC quantity unit en"],
            currency=c["SC currency"],
            ageing_days=int(_num(c["Avg. SC ageing"])),
            qty=_num(c["SC quantity"]),
            eur_unit_price=_num(c["Avg. SC net price per unit in EUR"]),
            eur_value=_num(c["SC value in EUR"]),
            inr_unit_price=_num(c["Avg. SC net price per unit in currency"]),
            inr_value=_num(c["SC value in currency"]),
            status=c["Status"],
        )
        positions.append(p)
        warnings.extend(_warnings_for(n, p))
    return ParseResult(positions, warnings)


def parse_report(path: str | Path) -> ParseResult:
    return parse_text(Path(path).read_bytes().decode("cp1252"))


def _fmt_num(v: float) -> str:
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.2f}"


def _us(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def _dm(d: date) -> str:
    return f"{d.day}/{d.month}/{d.year}"


def render_report(positions: list[CartPosition]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(RAW_HEADERS)
    last = None
    for p in positions:
        w.writerow([
            p.cart_no if p.cart_no != last else "", p.pos, p.description, p.company_id,
            p.company, p.order_for_id, p.order_for, p.purch_org, p.purch_group,
            p.purch_group_short, p.eclass, _us(p.create_date), _dm(p.approval_date),
            _us(p.delivery_from), _us(p.delivery_to), p.requestor, p.req_cost_centre,
            p.cost_centre, p.account_assignment, p.value_type, p.price_unit, p.qty_unit,
            p.currency, p.ageing_days, _fmt_num(p.qty), _fmt_num(p.eur_unit_price),
            _fmt_num(p.eur_value), _fmt_num(p.inr_unit_price), _fmt_num(p.inr_value), p.status,
        ])
        last = p.cart_no
    return buf.getvalue()


def write_report(positions: list[CartPosition], path: str | Path) -> None:
    Path(path).write_bytes(render_report(positions).encode("cp1252"))
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_importer.py -v`
Expected: all PASS. If `test_dates_follow_the_column_formats` fails on the approval date, stop and report it: it means A46 is wrong for this file.

- [ ] **Step 5: Commit**

```bash
git add backend/app/importer.py backend/tests/test_importer.py
git commit -m "Add the shopping cart report importer with header cleanup, forward-filled cart numbers, shifted-row warnings and a lossless round trip."
```

---

### Task 7: Seed foundations (constants, pricing, catalog, vendors)

**Files:**
- Create: `backend/app/seed/__init__.py`, `constants.py`, `pricing.py`, `catalog.py`, `vendors.py`
- Test: `backend/tests/test_seed_foundations.py`

**Interfaces:**
- Produces: `SEED`, `TODAY`, `EUR_RATE`; `round_price(x)`, `step(x)`; `Template`, `BuyCategory` (with `.eclass`), `ScrapMaterial`; `BUY_CATEGORIES` (10), `SCRAP_MATERIALS` (18), `FAMILY_TITLES`, `REQUESTORS`, `SCRAP_REQUESTORS`; `build_vendors(rng) -> list[Vendor]` (30 suppliers `V001`-`V030`, 16 scrap buyers `V031`-`V046`); `pool(vendors, category_key) -> list[Vendor]` sorted by id.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_seed_foundations.py
import random

from app.seed.catalog import BUY_CATEGORIES, SCRAP_MATERIALS
from app.seed.constants import SEED
from app.seed.pricing import round_price, step
from app.seed.vendors import build_vendors, pool


def test_round_price_rules():
    assert round_price(285.4) == 285.0
    assert round_price(46.789) == 46.79
    assert step(285) == 1.0 and step(46) == 0.01


def test_catalog_shape():
    assert len(BUY_CATEGORIES) == 10
    assert len(SCRAP_MATERIALS) == 18
    assert BUY_CATEGORIES[0].eclass == "25200000 - Gastronomie Und Bewirtung (Dienstleistung)"
    for c in BUY_CATEGORIES:
        for t in c.templates:
            assert t.qty_lo <= t.qty_hi and t.price_lo <= t.price_hi


def test_vendor_counts_and_ids():
    vs = build_vendors(random.Random(SEED))
    assert len(vs) == 46
    assert len({v.id for v in vs}) == 46
    assert len({v.sap_no for v in vs}) == 46
    assert all(len(v.sap_no) == 10 and v.sap_no.isdigit() for v in vs)
    assert len([v for v in vs if v.type == "scrap_buyer"]) == 16


def test_every_category_has_enough_bidders():
    vs = build_vendors(random.Random(SEED))
    for c in BUY_CATEGORIES:
        assert len(pool(vs, c.code)) >= 5
    for m in SCRAP_MATERIALS:
        assert len(pool(vs, m.family)) >= 4
    assert len(pool(vs, "aluminium")) == 5


def test_vendor_build_is_deterministic():
    a = build_vendors(random.Random(SEED))
    b = build_vendors(random.Random(SEED))
    assert a == b
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_seed_foundations.py -v`
Expected: FAIL (`ModuleNotFoundError: app.seed`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/seed/__init__.py
"""Deterministic seed data generator."""
```

```python
# file: backend/app/seed/constants.py
from datetime import date

SEED = 20260929
TODAY = date(2026, 9, 29)
EUR_RATE = 92.5  # illustrative INR per EUR (A2)
```

```python
# file: backend/app/seed/pricing.py
def round_price(x: float) -> float:
    """Whole rupees from 100 up, two decimals below."""
    return float(round(x)) if x >= 100 else round(x, 2)


def step(x: float) -> float:
    """Smallest price increment at this price level."""
    return 1.0 if x >= 100 else 0.01
```

```python
# file: backend/app/seed/catalog.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Template:
    description: str
    unit: str
    qty_lo: int
    qty_hi: int
    price_lo: int
    price_hi: int


@dataclass(frozen=True)
class BuyCategory:
    code: str
    name: str
    short: str
    kind: str
    templates: tuple[Template, ...]

    @property
    def eclass(self) -> str:
        return f"{self.code} - {self.name}"


BUY_CATEGORIES = (
    BuyCategory("25200000", "Gastronomie Und Bewirtung (Dienstleistung)", "A05", "service", (
        Template("Meals For Training Batch", "EA", 40, 200, 180, 320),
        Template("Tea And Snacks For Review Meeting", "EA", 20, 120, 45, 110),
        Template("Working Lunch Boxes", "EA", 30, 150, 150, 260),
        Template("Delegation Lunch Buffet", "EA", 100, 400, 250, 310),
    )),
    BuyCategory("41120214", "Eventcatering", "G09", "service", (
        Template("Client Dinner Catering", "AU", 1, 1, 25000, 80000),
        Template("Annual Day Event Catering", "EA", 150, 400, 300, 520),
        Template("Guest Refreshment Counter Setup", "AU", 1, 2, 8000, 20000),
    )),
    BuyCategory("24321900", "Projektor", "GPN", "goods", (
        Template("Portable Projector Full HD", "EA", 1, 4, 28000, 45000),
        Template("Tripod Stand Projector Screen 10x8 Ft", "EA", 1, 4, 9000, 16000),
        Template("Wireless Presenter Clicker", "EA", 2, 10, 1800, 3500),
    )),
    BuyCategory("43211500", "IT Accessories", "GPN", "goods", (
        Template("Wireless Keyboard Mouse Combo", "EA", 10, 40, 900, 2200),
        Template("USB C Docking Station", "EA", 5, 25, 3500, 7500),
        Template("HDMI Cable 3 Mtr", "EA", 20, 100, 150, 420),
    )),
    BuyCategory("44121600", "Stationery", "A05", "goods", (
        Template("A4 Copier Paper 75 GSM Ream", "EA", 100, 600, 215, 290),
        Template("Whiteboard Markers Box", "EA", 20, 100, 180, 320),
        Template("File Folders", "EA", 100, 500, 25, 60),
    )),
    BuyCategory("90101500", "Facility Services", "G09", "service", (
        Template("Housekeeping Service Monthly", "AU", 1, 3, 45000, 90000),
        Template("Pest Control Annual Contract", "AU", 1, 1, 30000, 70000),
        Template("Garden Maintenance Monthly", "AU", 1, 3, 18000, 40000),
    )),
    BuyCategory("82121500", "Printing Services", "A05", "service", (
        Template("Visitor Brochure Printing", "EA", 500, 3000, 18, 60),
        Template("Safety Poster Printing A2", "EA", 50, 300, 90, 240),
        Template("Employee Handbook Printing", "EA", 100, 600, 120, 300),
    )),
    BuyCategory("78101800", "Transport And Logistics", "G07", "service", (
        Template("Employee Shuttle Hire Monthly", "AU", 1, 3, 40000, 85000),
        Template("Courier Charges Bulk Dispatch", "AU", 1, 2, 12000, 35000),
        Template("Visitor Cab Hire Package", "AU", 1, 4, 6000, 18000),
    )),
    BuyCategory("86101700", "Training Services", "G05", "service", (
        Template("Soft Skills Workshop Per Batch", "AU", 1, 3, 25000, 60000),
        Template("Excel Advanced Training Per Batch", "AU", 1, 3, 18000, 45000),
        Template("First Aid Training Per Batch", "AU", 1, 3, 12000, 30000),
    )),
    BuyCategory("40101800", "Maintenance Consumables", "G03", "goods", (
        Template("Lubricant Grease 18 Kg Pail", "EA", 4, 20, 3800, 6200),
        Template("Cotton Waste Bale", "EA", 20, 120, 600, 1100),
        Template("Safety Gloves Pairs", "EA", 100, 400, 45, 120),
    )),
)


@dataclass(frozen=True)
class ScrapMaterial:
    family: str
    description: str
    price_lo: int  # illustrative INR/kg (A10)
    price_hi: int


SCRAP_MATERIALS = (
    ScrapMaterial("aluminium", "Aluminium Turnings", 152, 168),
    ScrapMaterial("aluminium", "Aluminium Extrusion Scrap", 172, 190),
    ScrapMaterial("aluminium", "Aluminium Cast Scrap", 156, 174),
    ScrapMaterial("copper", "Copper Bare Bright", 720, 780),
    ScrapMaterial("copper", "Copper Mixed Scrap", 650, 700),
    ScrapMaterial("brass", "Brass Scrap", 400, 480),
    ScrapMaterial("steel", "MS HMS Scrap", 28, 38),
    ScrapMaterial("steel", "Steel Turnings", 22, 30),
    ScrapMaterial("stainless", "Stainless Steel 304 Scrap", 80, 110),
    ScrapMaterial("cast_iron", "Cast Iron Scrap", 25, 32),
    ScrapMaterial("plastic", "PP Plastic Scrap", 30, 40),
    ScrapMaterial("plastic", "PVC Scrap", 18, 26),
    ScrapMaterial("plastic", "Mixed Plastic Scrap", 12, 22),
    ScrapMaterial("ewaste", "E-Waste Mixed", 40, 90),
    ScrapMaterial("oil", "Used Oil Drums", 22, 38),
    ScrapMaterial("paper", "Cardboard And Paper Scrap", 9, 14),
    ScrapMaterial("wood", "Wooden Pallet Scrap", 5, 9),
    ScrapMaterial("rubber", "Rubber Scrap", 8, 15),
)

FAMILIES = ("aluminium", "copper", "brass", "steel", "stainless", "cast_iron", "plastic",
            "ewaste", "oil", "paper", "wood", "rubber")
FAMILY_TITLES = {
    "aluminium": "Aluminium", "copper": "Copper", "brass": "Brass", "steel": "Steel",
    "stainless": "Stainless Steel", "cast_iron": "Cast Iron", "plastic": "Plastics",
    "ewaste": "E-Waste", "oil": "Used Oil", "paper": "Paper And Cardboard",
    "wood": "Wood", "rubber": "Rubber",
}

REQUESTORS = (
    "MRUNAL PAWAR", "SHALINI RAJENDRA", "SAGAR SATHE", "NEHA KULKARNI", "AMIT DESHMUKH",
    "PRIYA JOSHI", "RAHUL PATIL", "SNEHA BHOSALE", "VIKRAM MORE", "KAVITA GAIKWAD",
    "ROHAN SHINDE", "ANJALI KADAM",
)
SCRAP_REQUESTORS = ("YARD COORDINATOR", "STORES HEAD", "EHS OFFICER", "MAINTENANCE LEAD")
```

```python
# file: backend/app/seed/vendors.py
from __future__ import annotations

import random

from app.models import Vendor
from app.seed.catalog import BUY_CATEGORIES, FAMILIES

_FIRST = ("Sahyadri", "Deccan", "Konkan", "Vidarbha", "Malwa", "Kaveri", "Godavari", "Narmada",
          "Bharat", "Shivneri", "Rajgad", "Pratap", "Gomti", "Tapi", "Indrayani")
_SECOND = ("Caterers", "Hospitality", "Office Systems", "Stationers", "Facility Services",
           "Printers", "Logistics", "Learning", "Industrial Supplies", "Events")
_FORM = ("Pvt Ltd", "Enterprises", "& Co")
_SCRAP_BUYERS = (
    "Sahyadri Metal Recyclers", "Deccan Alloys Traders", "Konkan Scrap Industries",
    "Vidarbha Smelters", "Malwa Metals Pvt Ltd", "Kaveri Reclaim Works",
    "Godavari Eco Recyclers", "Narmada Ewaste Solutions", "Bharat Steel Scrap Co",
    "Shivneri Polymers Recycling", "Rajgad Oil Refiners", "Pratap Paper Mills Scrap Desk",
    "Gomti Rubber Reclaim", "Tapi Wood And Pallet Traders", "Indrayani Metals Exchange",
    "Pune Circular Materials",
)


def build_vendors(rng: random.Random) -> list[Vendor]:
    vendors: list[Vendor] = []
    for i in range(30):
        vendors.append(Vendor(
            id=f"V{i + 1:03d}",
            name=f"{_FIRST[i % 15]} {_SECOND[i % 10]} {_FORM[i % 3]}",
            sap_no=str(3300100000 + i * 137),
            type="supplier",
            categories=[BUY_CATEGORIES[i % 10].code, BUY_CATEGORIES[(i + 3) % 10].code],
            rating=round(3.2 + rng.random() * 1.7, 1),
            payment_pref=rng.choice(["ZD30", "ZD45", "ZD60"]),
            past_deals=rng.randint(3, 60),
        ))
    for j, name in enumerate(_SCRAP_BUYERS):
        cats = sorted({FAMILIES[(j + k) % 12] for k in (0, 1, 5, 7)})
        vendors.append(Vendor(
            id=f"V{31 + j:03d}",
            name=name,
            sap_no=str(3300100000 + (30 + j) * 137),
            type="scrap_buyer",
            categories=cats,
            rating=round(3.0 + rng.random() * 1.8, 1),
            payment_pref=rng.choice(["ADV", "ZD15", "ZD30", "LC"]),
            past_deals=rng.randint(3, 80),
        ))
    return vendors


def pool(vendors: list[Vendor], category_key: str) -> list[Vendor]:
    return sorted((v for v in vendors if category_key in v.categories), key=lambda v: v.id)
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_seed_foundations.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed backend/tests/test_seed_foundations.py
git commit -m "Add the seed foundations: constants, price rounding, category and scrap catalogs, and 46 vendors."
```

---

### Task 8: Cart positions and hero specs

**Files:**
- Create: `backend/app/seed/carts.py`, `backend/app/seed/heroes.py`
- Test: `backend/tests/test_seed_carts.py`

**Interfaces:**
- Consumes: Task 6 `CartPosition`; Task 7 catalog, constants.
- Produces: `make_position(...) -> CartPosition`; `make_cart_positions(rng) -> list[CartPosition]` (59 carts, 4 deliberately ineligible: carts 7, 23, 41 oversize, cart 15 tiny); `heroes.HERO_BUY_ID = "EVT-2026-041"`, `HERO_SELL_ID = "EVT-2026-052"`, `HERO_BUY_CART`, `HERO_BUY_TITLE`, `HERO_BUY_ITEMS` (tuple of dicts), `HERO_SELL` (dict), `hero_buy_positions() -> list[CartPosition]`.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_seed_carts.py
import random

from app import eligibility
from app.seed import heroes
from app.seed.carts import make_cart_positions
from app.seed.constants import SEED, TODAY


def _carts(positions):
    out = {}
    for p in positions:
        out.setdefault(p.cart_no, []).append(p)
    return out


def test_cart_and_position_counts():
    ps = make_cart_positions(random.Random(SEED))
    carts = _carts(ps)
    assert len(carts) == 59
    assert len(ps) >= 150


def test_values_are_exact_and_positions_numbered():
    for p in make_cart_positions(random.Random(SEED)):
        assert p.qty * p.inr_unit_price == p.inr_value
        assert not p.shifted
    for ps in _carts(make_cart_positions(random.Random(SEED))).values():
        assert [p.pos for p in ps] == list(range(1, len(ps) + 1))
        assert ps[0].status == "Open" and all(p.status == "" for p in ps[1:])


def test_dates_are_ordered_and_in_the_past():
    for p in make_cart_positions(random.Random(SEED)):
        assert p.create_date <= p.approval_date <= p.delivery_from <= p.delivery_to
        assert p.create_date < TODAY


def test_exactly_four_carts_are_ineligible():
    carts = _carts(make_cart_positions(random.Random(SEED)))
    bad = [c for c, ps in carts.items()
           if not eligibility.check_value(sum(p.qty * p.inr_unit_price for p in ps)).eligible]
    assert len(bad) == 4


def test_hero_buy_cart():
    ps = heroes.hero_buy_positions()
    assert len(ps) == 6 and {p.cart_no for p in ps} == {heroes.HERO_BUY_CART}
    lunch = ps[0]
    assert lunch.description == "Delegation Lunch Buffet"
    assert lunch.qty == 600 and lunch.inr_unit_price == 280
    total = sum(p.qty * p.inr_unit_price for p in ps)
    assert eligibility.check_value(total, eligibility.PHASE_1).eligible


def test_hero_buy_numbers():
    item = heroes.HERO_BUY_ITEMS[0]
    assert item["prices"] == [285, 292, 298, 305, 312]
    assert (item["target"], item["limit"]) == (250, 270)
    assert item["reserves"][0] == 268


def test_hero_sell_numbers():
    h = heroes.HERO_SELL
    assert h["qty"] == 5000 and h["ref"] == 165
    assert h["prices"] == [163, 162, 161.5, 158, 154]
    assert (h["target"], h["limit"]) == (170, 165)
    assert h["reserves"][0] == 169
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_seed_carts.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/seed/carts.py
from __future__ import annotations

import random
from datetime import date, timedelta

from app.importer import CartPosition
from app.seed.catalog import BUY_CATEGORIES, REQUESTORS, BuyCategory
from app.seed.constants import EUR_RATE, TODAY

OVERSIZE_CARTS = {7, 23, 41}
TINY_CART = 15
_VW_DIGITAL = ("9790", "Volkswagen Group Digital Sol Pvt Ltd")
_PUNE = ("0800", "Plant Pune")


def make_position(
    *, cart_no: str, pos: int, description: str, cat: BuyCategory, unit: str, qty: int,
    price: int, created: date, order_for: tuple[str, str], requestor: str, cost_centre: str,
) -> CartPosition:
    approval = created + timedelta(days=2)
    delivery_from = approval + timedelta(days=5)
    delivery_to = delivery_from + timedelta(days=25)
    inr_value = float(qty * price)
    eur_value = float(round(inr_value / EUR_RATE))
    lpos = order_for[0] == "0800"
    return CartPosition(
        cart_no=cart_no, pos=pos, description=description, company_id="0800",
        company="SKODA Auto VW India", order_for_id=order_for[0], order_for=order_for[1],
        purch_org="Purchasing Organisation LPOS (SAVWIPL)" if lpos else "Purchase Organisation LPOS",
        purch_group=f"Purchasing Group {cat.short}", purch_group_short=cat.short,
        eclass=cat.eclass, create_date=created, approval_date=approval,
        delivery_from=delivery_from, delivery_to=delivery_to, requestor=requestor,
        req_cost_centre=cost_centre, cost_centre=cost_centre, account_assignment="ZCC",
        value_type="CTM (<10k €)" if eur_value < 10000 else "Standard (>=10k €)",
        price_unit=1, qty_unit=unit, currency="INR", ageing_days=(TODAY - created).days,
        qty=float(qty), eur_unit_price=round(price / EUR_RATE, 2), eur_value=eur_value,
        inr_unit_price=float(price), inr_value=inr_value, status="Open" if pos == 1 else "",
    )


def make_cart_positions(rng: random.Random) -> list[CartPosition]:
    out: list[CartPosition] = []
    for c in range(59):
        cart_no = str(1012360000 + c * 53)
        created = TODAY - timedelta(days=30 + (c * 11) % 150)
        order_for = _VW_DIGITAL if c % 6 == 5 else _PUNE
        requestor = rng.choice(REQUESTORS)
        cost_centre = str(2170000 + 1000 * rng.randint(0, 12))
        cat = BUY_CATEGORIES[4 if c == TINY_CART else c % 10]
        if c == TINY_CART:
            picks = [(cat.templates[2], 40, 25)]
        else:
            n_pos = min(2 + c % 3, len(cat.templates))
            picks = []
            for t in rng.sample(cat.templates, n_pos):
                picks.append((t, rng.randint(t.qty_lo, t.qty_hi), rng.randint(t.price_lo, t.price_hi)))
            if c in OVERSIZE_CARTS:
                t, _, price = picks[0]
                picks[0] = (t, -(-1_100_000 // price), price)
        for pos, (t, qty, price) in enumerate(picks, start=1):
            out.append(make_position(
                cart_no=cart_no, pos=pos, description=t.description, cat=cat, unit=t.unit,
                qty=qty, price=price, created=created, order_for=order_for,
                requestor=requestor, cost_centre=cost_centre,
            ))
    return out
```

```python
# file: backend/app/seed/heroes.py
"""Hand-authored hero events (A40, A41). Numbers are documented in the design spec section 5."""
from __future__ import annotations

from datetime import timedelta

from app.importer import CartPosition
from app.seed.carts import make_position
from app.seed.catalog import BUY_CATEGORIES
from app.seed.constants import TODAY

HERO_BUY_ID = "EVT-2026-041"
HERO_SELL_ID = "EVT-2026-052"
HERO_BUY_CART = "1012399041"
HERO_BUY_TITLE = "Meals For Delegation Visit To Savwipl"

_CODES = ["ZD30", "ZD30", "ZD45", "ZD30", "ZD60"]
_DAYS = [3, 3, 4, 3, 5]

# (position, description, unit, qty, reference price, bid prices best-first, target, ceiling,
#  hidden vendor reserves)
_BUY_ROWS = (
    (1, "Delegation Lunch Buffet", "EA", 600, 280, [285, 292, 298, 305, 312], 250, 270,
     [268, 274, 279, 285, 290]),
    (2, "Welcome Tea And Snacks", "EA", 600, 52, [53, 55, 57, 58, 60], 46, 50,
     [49, 52, 54, 56, 58]),
    (3, "Plant Visit Refreshment Kits", "EA", 200, 120, [122, 126, 129, 133, 138], 108, 115,
     [112, 118, 122, 125, 130]),
    (4, "Dinner Buffet Day 1", "EA", 150, 340, [345, 352, 360, 368, 377], 305, 325,
     [320, 330, 338, 345, 355]),
    (5, "Mineral Water 1 Ltr Cartons", "EA", 100, 260, [262, 268, 275, 281, 290], 238, 250,
     [246, 255, 262, 270, 280]),
    (6, "Service Staff And Live Counters", "AU", 1, 18000,
     [18500, 19000, 19600, 20200, 20800], 16500, 17500, [17200, 17800, 18400, 19000, 19800]),
)

HERO_BUY_ITEMS = tuple(
    {
        "position": pos, "description": desc, "unit": unit, "qty": qty, "ref": ref,
        "prices": prices, "target": target, "limit": limit, "reserves": reserves,
        "payment_codes": _CODES, "delivery_days": _DAYS, "incoterm": "FH",
    }
    for pos, desc, unit, qty, ref, prices, target, limit, reserves in _BUY_ROWS
)

HERO_SELL = {
    "title": "Aluminium Turnings Lot - 5,000 kg",
    "description": "Aluminium Turnings",
    "family": "aluminium",
    "qty": 5000,
    "ref": 165,  # illustrative market reference INR/kg
    "prices": [163, 162, 161.5, 158, 154],
    "target": 170,
    "limit": 165,  # floor
    "reserves": [169, 167, 166, 163, 158],
    "payment_codes": ["ADV", "ZD30", "ZD30", "ZD45", "LC"],
    "delivery_days": [5, 7, 7, 10, 5],
    "incoterm": "EXW",
}


def hero_buy_positions() -> list[CartPosition]:
    cat = BUY_CATEGORIES[0]
    created = TODAY - timedelta(days=3)
    return [
        make_position(
            cart_no=HERO_BUY_CART, pos=row["position"], description=row["description"], cat=cat,
            unit=row["unit"], qty=row["qty"], price=row["ref"], created=created,
            order_for=("0800", "Plant Pune"), requestor="MRUNAL PAWAR", cost_centre="2176000",
        )
        for row in HERO_BUY_ITEMS
    ]
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_seed_carts.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed/carts.py backend/app/seed/heroes.py backend/tests/test_seed_carts.py
git commit -m "Add deterministic cart position generation with four deliberately ineligible carts, and the hand-authored hero events."
```

---

### Task 9: Scrap lots and history

**Files:**
- Create: `backend/app/seed/scrap.py`, `backend/app/seed/history.py`
- Test: `backend/tests/test_seed_scrap_history.py`

**Interfaces:**
- Consumes: Task 7 catalog, pricing, vendors, constants; Task 5 `HistoryRecord`.
- Produces: `LotSpec(material, qty, ref)` dataclass; `make_lots(rng) -> list[LotSpec]` (24 lots; indexes 1 and 7 oversize, 14 undersize); `build_history(rng, vendors) -> list[HistoryRecord]` (6 per template: 31 BUY + 18 SELL templates = 294 rows, sorted by date then id).

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_seed_scrap_history.py
import random
from datetime import timedelta

from app import deal, eligibility
from app.seed.constants import SEED, TODAY
from app.seed.history import build_history
from app.seed.scrap import make_lots
from app.seed.vendors import build_vendors


def test_lot_count_and_bands():
    lots = make_lots(random.Random(SEED))
    assert len(lots) == 24
    bad = [i for i, l in enumerate(lots) if not eligibility.check_value(l.qty * l.ref).eligible]
    assert bad == [1, 7, 14]


def test_lot_prices_stay_in_material_ranges():
    for l in make_lots(random.Random(SEED)):
        assert l.material.price_lo <= l.ref <= l.material.price_hi


def test_history_size_and_window():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    assert len(hs) >= 200
    assert len({h.id for h in hs}) == len(hs)
    for h in hs:
        assert TODAY - timedelta(days=560) <= h.closed_date <= TODAY - timedelta(days=1)
    assert [h.closed_date for h in hs] == sorted(h.closed_date for h in hs)


def test_history_vendors_exist_and_serve_the_category():
    vs = {v.id: v for v in build_vendors(random.Random(SEED))}
    for h in build_history(random.Random(SEED), list(vs.values())):
        assert h.category_key in vs[h.vendor_id].categories


def test_negotiated_rows_show_a_clear_gain():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    negotiated = [h for h in hs if h.negotiated]
    assert len(negotiated) >= 60
    for h in negotiated:
        assert h.original_price is not None
        assert deal.realised_delta(h.direction, h.original_price, h.unit_price, h.qty) > 0
    assert all(h.original_price is None for h in hs if not h.negotiated)


def test_hero_materials_have_history():
    vs = build_vendors(random.Random(SEED))
    hs = build_history(random.Random(SEED), vs)
    for name in ("Delegation Lunch Buffet", "Aluminium Turnings"):
        assert len([h for h in hs if h.description == name]) == 6
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_seed_scrap_history.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/seed/scrap.py
from __future__ import annotations

import random
from dataclasses import dataclass

from app.seed.catalog import SCRAP_MATERIALS, ScrapMaterial
from app.seed.pricing import round_price

OVERSIZE = {1: 20000, 7: 60000}  # kg; both exceed INR 10 lakh
UNDERSIZE = {14: 40}  # kg; below INR 2,000


@dataclass(frozen=True)
class LotSpec:
    material: ScrapMaterial
    qty: int
    ref: float


def make_lots(rng: random.Random) -> list[LotSpec]:
    lots: list[LotSpec] = []
    for i in range(24):
        m = SCRAP_MATERIALS[i % len(SCRAP_MATERIALS)]
        ref = round_price(rng.uniform(m.price_lo, m.price_hi))
        if i in OVERSIZE:
            qty = OVERSIZE[i]
        elif i in UNDERSIZE:
            qty = UNDERSIZE[i]
        else:
            target_value = rng.uniform(40_000, 850_000)
            qty = max(10, round(target_value / ref / 10) * 10)
        lots.append(LotSpec(m, qty, ref))
    return lots
```

```python
# file: backend/app/seed/history.py
from __future__ import annotations

import random
from datetime import timedelta

from app.models import HistoryRecord, Vendor
from app.seed.catalog import BUY_CATEGORIES, SCRAP_MATERIALS
from app.seed.constants import TODAY
from app.seed.pricing import round_price, step
from app.seed.vendors import pool

PER_TEMPLATE = 6


def build_history(rng: random.Random, vendors: list[Vendor]) -> list[HistoryRecord]:
    specs = []
    for cat in BUY_CATEGORIES:
        for t in cat.templates:
            specs.append(("buy", cat.code, t.description, t.unit, t.price_lo, t.price_hi,
                          t.qty_lo, t.qty_hi))
    for m in SCRAP_MATERIALS:
        specs.append(("sell", m.family, m.description, "KG", m.price_lo, m.price_hi, 500, 8000))

    rows: list[HistoryRecord] = []
    n = PER_TEMPLATE
    for direction, key, desc, unit, lo, hi, qlo, qhi in specs:
        vendor_pool = pool(vendors, key)
        base = (lo + hi) / 2
        for k in range(n):
            age = (n - 1 - k) / (n - 1)  # 1 = oldest
            days_ago = 30 + round(age * 480) + rng.randint(0, 10)
            if direction == "buy":
                price = base * (1 + 0.05 * (1 - age)) * (1 + rng.uniform(-0.04, 0.04))
            else:
                price = base * (1 + rng.uniform(-0.06, 0.06))
            unit_price = round_price(price)
            negotiated = k % 3 == 2
            original = None
            if negotiated:
                if direction == "buy":
                    original = max(round_price(price / (1 - rng.uniform(0.03, 0.08))),
                                   round(unit_price + step(unit_price), 2))
                else:
                    original = min(round_price(price / (1 + rng.uniform(0.03, 0.07))),
                                   round(unit_price - step(unit_price), 2))
            qty = rng.randint(qlo, qhi)
            if direction == "sell":
                qty = qty // 10 * 10
            rows.append(HistoryRecord(
                id="", description=desc, category_key=key, direction=direction,
                vendor_id=rng.choice(vendor_pool).id, unit_price=unit_price, qty=float(qty),
                unit=unit, closed_date=TODAY - timedelta(days=days_ago),
                negotiated=negotiated, original_price=original,
            ))
    rows.sort(key=lambda r: (r.closed_date, r.description))
    return [r.model_copy(update={"id": f"H{i + 1:04d}"}) for i, r in enumerate(rows)]
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_seed_scrap_history.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed/scrap.py backend/app/seed/history.py backend/tests/test_seed_scrap_history.py
git commit -m "Add scrap lot generation with three out-of-band lots, and 294 history records over eighteen months."
```

---

### Task 10: Dataset builder (events, items, bids, outcomes)

**Files:**
- Create: `backend/app/seed/build.py`
- Test: `backend/tests/test_seed_dataset.py`

**Interfaces:**
- Consumes: everything from Tasks 2 to 9.
- Produces: `build_positions() -> list[CartPosition]` (round-tripped through `importer`); `build_dataset() -> Dataset`; module constants `OUTPUT_DIR`. Rules implemented: event ids `EVT-2026-001..085` with heroes fixed at 041 and 052; stage plan per direction (BUY: closed 2, negotiating 1, handed_back 1, acceptable 2, analyzed 20, awaiting_bids 12, rest draft; SELL: closed 2, negotiating 1, handed_back 1, acceptable 1, analyzed 8, awaiting_bids 5, rest draft); ineligible events are forced to `draft`; `draft`/`awaiting_bids` items keep their bids in `scripted_bids`; `draft` items have `target`/`limit` = None (suggested values always set); closed events get an `Outcome` for the first half (rounded up) of their items.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_seed_dataset.py
from collections import Counter
from datetime import timedelta

import pytest

from app import deal, eligibility
from app.importer import parse_text, render_report
from app.seed import heroes
from app.seed.build import build_dataset, build_positions
from app.seed.constants import TODAY


@pytest.fixture(scope="module")
def ds():
    return build_dataset()


@pytest.fixture(scope="module")
def positions():
    return build_positions()


def _events(ds):
    return {e.id: e for e in ds.events}


def _all_bids(ds, item_id):
    return ds.item_bids(item_id) + ds.item_bids(item_id, scripted=True)


def test_scale(ds, positions):
    assert len(positions) >= 150
    assert len({p.cart_no for p in positions}) >= 60
    assert len([v for v in ds.vendors if v.type == "supplier"]) >= 25
    assert len(ds.vendors) >= 40
    assert len([v for v in ds.vendors if v.type == "scrap_buyer"]) >= 15
    assert len([e for e in ds.events if e.type == "scrap_sale"]) >= 25
    assert len([e for e in ds.events if e.type == "shopping_cart"]) == 60
    assert len(ds.history) >= 200


def test_ids_are_unique_and_heroes_fixed(ds):
    ids = [e.id for e in ds.events]
    assert len(ids) == len(set(ids)) == 85
    ev = _events(ds)
    assert ev[heroes.HERO_BUY_ID].hero and ev[heroes.HERO_BUY_ID].direction == "buy"
    assert ev[heroes.HERO_SELL_ID].hero and ev[heroes.HERO_SELL_ID].direction == "sell"


def test_csv_positions_round_trip_and_match_items(ds, positions):
    assert parse_text(render_report(positions)).positions == positions
    buy_items = [i for i in ds.items if _events(ds)[i.event_id].direction == "buy"]
    assert len(buy_items) == len(positions)


def test_no_duplicate_vendor_per_item_and_vendors_exist(ds):
    vendors = {v.id: v for v in ds.vendors}
    ev = _events(ds)
    for item in ds.items:
        bids = _all_bids(ds, item.id)
        assert len({b.vendor_id for b in bids}) == len(bids)
        for b in bids:
            assert item.event_id in ev
            assert ev[item.event_id].category_key in vendors[b.vendor_id].categories


def test_bid_counts_and_spreads(ds):
    ev = _events(ds)
    for item in ds.items:
        bids = _all_bids(ds, item.id)
        assert 3 <= len(bids) <= 6
        prices = [b.unit_price for b in bids]
        if ev[item.event_id].direction == "buy":
            assert 0.05 <= max(prices) / min(prices) - 1 <= 0.15
        else:
            assert 0.035 <= (max(prices) - min(prices)) / max(prices) <= 0.125


def test_anchor_rules(ds):
    ev = _events(ds)
    for item in ds.items:
        e = ev[item.event_id]
        best = deal.best_price(e.direction, [b.unit_price for b in _all_bids(ds, item.id)])
        t, lim = item.suggested_target, item.suggested_limit
        if e.acceptable:
            assert deal.within_limit(e.direction, best, lim)
            assert (t <= best) if e.direction == "buy" else (t > best)
        else:
            assert deal.anchors_valid(e.direction, t, lim, best), item.id
        if item.target is not None:
            assert (item.target, item.limit) == (t, lim)
        else:
            assert e.stage in ("draft",)


def test_vendor_reserves(ds):
    ev = _events(ds)
    for item in ds.items:
        e = ev[item.event_id]
        bids = sorted(_all_bids(ds, item.id), key=lambda b: b.unit_price,
                      reverse=e.direction == "sell")
        for b in bids:
            if e.direction == "buy":
                assert b.reserve <= b.unit_price
            else:
                assert b.reserve >= b.unit_price
        no_deal_item = e.no_deal and item.position == 1
        best = bids[0]
        if no_deal_item:
            for b in bids:
                assert not deal.within_limit(e.direction, b.reserve, item.suggested_limit)
        else:
            assert deal.within_limit(e.direction, best.reserve, item.suggested_limit)


def test_dates(ds):
    for e in ds.events:
        assert e.created <= e.approval_date <= e.due
    ev = _events(ds)
    for o in ds.outcomes:
        item = next(i for i in ds.items if i.id == o.item_id)
        assert ev[item.event_id].approval_date <= o.closed_date <= TODAY - timedelta(days=1)


def test_stage_mix(ds):
    c = Counter(e.stage for e in ds.events)
    assert c["closed"] == 4
    assert c["negotiating"] == 2
    assert c["handed_back"] == 2
    assert c["analyzed"] >= 8
    assert sum(1 for e in ds.events if e.acceptable) == 3
    assert sum(1 for e in ds.events if e.no_deal) == 2


def test_closed_events_have_outcomes_within_limits(ds):
    ev = _events(ds)
    closed_ids = {e.id for e in ds.events if e.stage == "closed"}
    assert {ev_id for ev_id in closed_ids} and ds.outcomes
    for o in ds.outcomes:
        item = next(i for i in ds.items if i.id == o.item_id)
        assert item.event_id in closed_ids and item.state == "closed"
        assert deal.within_limit(o.direction, o.final_price, item.limit)
        assert deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty) > 0
        assert o.original_price == deal.best_price(
            o.direction, [b.unit_price for b in ds.item_bids(o.item_id)])
    for eid in closed_ids:
        n = len(ds.event_items(eid))
        got = len([o for o in ds.outcomes if o.item_id.startswith(eid)])
        assert got == -(-n // 2)


def test_eligibility_split(ds):
    ev = _events(ds)
    bad = {e.id for e in ds.events if not eligibility.check_value(ds.event_value(e.id)).eligible}
    assert len([b for b in bad if ev[b].direction == "buy"]) == 4
    assert len([b for b in bad if ev[b].direction == "sell"]) == 3
    assert all(ev[b].stage == "draft" for b in bad)
    assert heroes.HERO_BUY_ID not in bad and heroes.HERO_SELL_ID not in bad


def test_item_states_match_event_stage(ds):
    for e in ds.events:
        states = {i.state for i in ds.event_items(e.id)}
        if e.stage in ("draft", "awaiting_bids", "analyzed", "closed"):
            assert states == {e.stage}
        else:  # negotiating / handed_back: first item in that state, any others stay analyzed
            assert e.stage in states and states <= {e.stage, "analyzed"}


def test_scripted_bids_only_before_bids_arrive(ds):
    live = {b.item_id for b in ds.bids}
    scripted = {b.item_id for b in ds.scripted_bids}
    assert not live & scripted
    ev = _events(ds)
    for item in ds.items:
        expect_scripted = ev[item.event_id].stage in ("draft", "awaiting_bids")
        assert (item.id in scripted) == expect_scripted


def test_hero_buy(ds):
    item = next(i for i in ds.items if i.id == f"{heroes.HERO_BUY_ID}-01")
    bids = ds.item_bids(item.id, scripted=True)
    assert [b.unit_price for b in bids] == [285, 292, 298, 305, 312]
    assert (item.suggested_target, item.suggested_limit, item.qty) == (250, 270, 600)
    assert deal.potential_delta("buy", 285, item.suggested_target, item.qty) == 21000
    assert deal.realised_delta("buy", 285, 270, item.qty) == 9000
    assert len(ds.event_items(heroes.HERO_BUY_ID)) == 6
    assert 300_000 <= ds.event_value(heroes.HERO_BUY_ID) <= 350_000
    assert _events(ds)[heroes.HERO_BUY_ID].stage == "draft"


def test_hero_sell(ds):
    item = ds.event_items(heroes.HERO_SELL_ID)[0]
    bids = ds.item_bids(item.id, scripted=True)
    assert [b.unit_price for b in bids] == [163, 162, 161.5, 158, 154]
    assert (item.suggested_target, item.suggested_limit, item.qty) == (170, 165, 5000)
    assert deal.potential_delta("sell", 163, 170, item.qty) == 35000
    assert deal.realised_delta("sell", 163, 168, item.qty) == 25000
    assert 800_000 <= ds.event_value(heroes.HERO_SELL_ID) <= 850_000


def test_build_is_deterministic():
    assert build_dataset().model_dump_json() == build_dataset().model_dump_json()
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_seed_dataset.py -v`
Expected: FAIL (`ModuleNotFoundError: app.seed.build`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/seed/build.py
from __future__ import annotations

import math
import random
from datetime import timedelta
from pathlib import Path

from app import eligibility
from app.importer import CartPosition, parse_text, render_report
from app.models import Bid, Dataset, Event, Item, Outcome
from app.seed import heroes
from app.seed.carts import make_cart_positions
from app.seed.catalog import FAMILY_TITLES, SCRAP_REQUESTORS
from app.seed.constants import SEED, TODAY
from app.seed.history import build_history
from app.seed.pricing import round_price, step
from app.seed.scrap import make_lots
from app.seed.vendors import build_vendors, pool

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"

BUY_COUNTS = (("closed", 2), ("negotiating", 1), ("handed_back", 1), ("acceptable", 2),
              ("analyzed", 20), ("awaiting_bids", 12))
SELL_COUNTS = (("closed", 2), ("negotiating", 1), ("handed_back", 1), ("acceptable", 1),
               ("analyzed", 8), ("awaiting_bids", 5))


class _Acc:
    def __init__(self) -> None:
        self.events: list[Event] = []
        self.items: list[Item] = []
        self.bids: list[Bid] = []
        self.scripted: list[Bid] = []
        self.outcomes: list[Outcome] = []


def build_positions() -> list[CartPosition]:
    """Generate carts plus the hero cart, then round-trip them through the real parser."""
    raw = make_cart_positions(random.Random(SEED + 2)) + heroes.hero_buy_positions()
    return parse_text(render_report(raw)).positions


def _stage_plan(rng: random.Random, n: int, counts) -> list[str]:
    plan = [stage for stage, c in counts for _ in range(c)]
    plan += ["draft"] * (n - len(plan))
    rng.shuffle(plan)
    return plan


def _anchors(rng: random.Random, direction: str, best: float, acceptable: bool):
    s = step(best)
    if direction == "buy":
        if acceptable:
            limit = max(round_price(best * (1 + rng.uniform(0.01, 0.04))), round(best + s, 2))
            target = min(round_price(best * (1 - rng.uniform(0.0, 0.02))), best)
        else:
            c = rng.uniform(0.02, 0.05)
            t = c + rng.uniform(0.03, 0.06)
            limit = min(round_price(best * (1 - c)), round(best - s, 2))
            target = min(round_price(best * (1 - t)), limit)
        return target, limit
    if acceptable:
        floor = min(round_price(best * (1 - rng.uniform(0.01, 0.03))), round(best - s, 2))
        target = max(round_price(best * (1 + rng.uniform(0.02, 0.05))), round(best + s, 2))
    else:
        c = rng.uniform(0.02, 0.04)
        t = c + rng.uniform(0.02, 0.05)
        floor = max(round_price(best * (1 + c)), round(best + s, 2))
        target = max(round_price(best * (1 + t)), floor)
    return target, floor


def _bid_prices(rng: random.Random, direction: str, best: float, n: int) -> list[float]:
    lo, hi = (0.06, 0.14) if direction == "buy" else (0.04, 0.12)
    spread = rng.uniform(lo, hi)
    fractions = sorted(rng.uniform(0.05, 0.95) for _ in range(n - 2)) + [1.0]
    sign = 1 if direction == "buy" else -1
    return [best] + [round_price(best * (1 + sign * spread * f)) for f in fractions]


def _reserve(rng: random.Random, direction: str, bid: float, limit: float, no_deal: bool) -> float:
    s = step(bid)
    if direction == "buy":
        if no_deal:
            v = round_price(limit + (bid - limit) * rng.uniform(0.3, 0.8))
            return min(max(v, round(limit + s, 2)), bid)
        return min(round_price(min(bid, limit) * (1 - rng.uniform(0.005, 0.02))), bid)
    if no_deal:
        v = round_price(limit - (limit - bid) * rng.uniform(0.3, 0.8))
        return max(min(v, round(limit - s, 2)), bid)
    return max(round_price(max(bid, limit) * (1 + rng.uniform(0.005, 0.02))), bid)


def _terms(rng: random.Random, direction: str, kind: str, vendor) -> dict:
    scrap = kind == "scrap"
    return {
        "payment_code": vendor.payment_pref if rng.random() < 0.6 else rng.choice(
            ["ADV", "ZD15", "ZD30", "LC"] if scrap else ["ZD30", "ZD45", "ZD60"]),
        "incoterm": rng.choice(["EXW", "FCA"]) if scrap else (
            "FH" if kind == "service" else rng.choice(["FH", "EXW", "DAP"])),
        "delivery_days": rng.randint(2, 15) if scrap else rng.randint(3, 30),
        "validity_days": rng.choice([30, 45, 60]),
        "warranty_months": 0 if kind != "goods" else rng.choice([12, 24]),
        "penalty_clause": rng.choice(["", "LD 0.5% per week capped at 5%"]),
        "language": rng.choice(["en", "en", "hi", "mr"]),
    }


def _item_state(stage: str, idx: int) -> str:
    if stage == "negotiating":
        return "negotiating" if idx == 1 else "analyzed"
    if stage == "handed_back":
        return "handed_back" if idx == 1 else "analyzed"
    return stage


def _add_item(rng, vendors, event: Event, idx: int, n_items: int, *, desc: str, kind: str,
              qty: float, unit: str, ref: float, incoterm: str, delivery_days: int,
              acc: _Acc, hero: dict | None = None) -> None:
    d = event.direction
    item_id = f"{event.id}-{idx:02d}"
    vendor_pool = pool(vendors, event.category_key)
    no_deal = event.no_deal and idx == 1
    if hero:
        prices, target, limit = hero["prices"], hero["target"], hero["limit"]
        reserves = hero["reserves"]
        chosen = vendor_pool[: len(prices)]
        assert len(chosen) == len(prices), "not enough vendors for hero bids"
        terms = [{
            "payment_code": hero["payment_codes"][k], "incoterm": hero["incoterm"],
            "delivery_days": hero["delivery_days"][k], "validity_days": 30,
            "warranty_months": 0, "penalty_clause": "", "language": "en",
        } for k in range(len(prices))]
    else:
        factor = rng.uniform(0.97, 1.04) if d == "buy" else rng.uniform(0.97, 1.0)
        best = round_price(ref * factor)
        target, limit = _anchors(rng, d, best, event.acceptable)
        n = min(rng.randint(3, 6), len(vendor_pool))
        prices = _bid_prices(rng, d, best, n)
        chosen = rng.sample(vendor_pool, n)
        reserves = [_reserve(rng, d, p, limit, no_deal) for p in prices]
        terms = [_terms(rng, d, kind, v) for v in chosen]
    bids = [
        Bid(id=f"{item_id}-B{k}", item_id=item_id, vendor_id=v.id, unit_price=float(p),
            reserve=float(r), **t)
        for k, (p, v, r, t) in enumerate(zip(prices, chosen, reserves, terms), start=1)
    ]
    pointed = event.stage != "draft"
    acc.items.append(Item(
        id=item_id, event_id=event.id, position=idx, description=desc, kind=kind, qty=qty,
        unit=unit, reference_price=ref, suggested_target=float(target),
        suggested_limit=float(limit), target=float(target) if pointed else None,
        limit=float(limit) if pointed else None, incoterm=incoterm, delivery_days=delivery_days,
        state=_item_state(event.stage, idx),
    ))
    (acc.scripted if event.stage in ("draft", "awaiting_bids") else acc.bids).extend(bids)
    if event.stage == "closed" and idx <= math.ceil(n_items / 2):
        if d == "buy":
            final = limit - (limit - target) * rng.uniform(0.0, 0.5)
            final = min(max(round_price(final), target), limit)
        else:
            final = limit + (target - limit) * rng.uniform(0.0, 0.5)
            final = max(min(round_price(final), target), limit)
        best_bid = bids[0]
        acc.outcomes.append(Outcome(
            item_id=item_id, vendor_id=best_bid.vendor_id, direction=d, qty=qty,
            original_price=best_bid.unit_price, final_price=float(final),
            closed_date=event.approval_date + timedelta(days=8 + 3 * idx),
            duration_minutes=rng.randint(8, 35),
        ))


def _add_buy_event(rng, vendors, event_id: str, ps: list[CartPosition], stage: str,
                   acc: _Acc, hero: bool = False) -> None:
    acceptable = stage == "acceptable"
    p0 = ps[0]
    title = heroes.HERO_BUY_TITLE if hero else (
        p0.description + (f" (+{len(ps) - 1} more)" if len(ps) > 1 else ""))
    event = Event(
        id=event_id, type="shopping_cart", direction="buy", title=title,
        company_id=p0.company_id, company=p0.company, plant=p0.order_for, purch_org=p0.purch_org,
        purch_group=p0.purch_group, category=p0.eclass, category_key=p0.eclass_code,
        requestor=p0.requestor, cost_centre=p0.cost_centre, created=p0.create_date,
        approval_date=p0.approval_date, due=p0.delivery_to, source_cart_no=p0.cart_no,
        hero=hero, acceptable=acceptable, no_deal=stage == "handed_back",
        stage="analyzed" if acceptable else stage,
    )
    acc.events.append(event)
    for idx, p in enumerate(ps, start=1):
        kind = "service" if p.qty_unit == "AU" or p.eclass_code in _SERVICE_CODES else "goods"
        _add_item(rng, vendors, event, idx, len(ps), desc=p.description, kind=kind,
                  qty=p.net_qty, unit=p.qty_unit, ref=p.net_unit_price, incoterm="FH",
                  delivery_days=(p.delivery_to - p.delivery_from).days, acc=acc,
                  hero=heroes.HERO_BUY_ITEMS[idx - 1] if hero else None)


def _cart_value(ps: list[CartPosition]) -> float:
    return sum(p.net_qty * p.net_unit_price for p in ps)


def _build_buy(rng, vendors, positions, free_ids, acc) -> None:
    carts: dict[str, list[CartPosition]] = {}
    for p in positions:
        carts.setdefault(p.cart_no, []).append(p)
    procedural = [ps for cart, ps in carts.items() if cart != heroes.HERO_BUY_CART]
    ok = [eligibility.check_value(_cart_value(ps)).eligible for ps in procedural]
    plan = iter(_stage_plan(rng, sum(ok), BUY_COUNTS))
    for ps, eligible in zip(procedural, ok):
        _add_buy_event(rng, vendors, free_ids.pop(0), ps, next(plan) if eligible else "draft", acc)
    _add_buy_event(rng, vendors, heroes.HERO_BUY_ID, carts[heroes.HERO_BUY_CART], "draft", acc,
                   hero=True)


def _add_sell_event(rng, vendors, event_id: str, *, i: int, material, qty: int, ref: float,
                    stage: str, acc: _Acc, hero: dict | None = None) -> None:
    acceptable = stage == "acceptable"
    created = TODAY - timedelta(days=2 if hero else 30 + (i * 13) % 150)
    event = Event(
        id=event_id, type="scrap_sale", direction="sell",
        title=hero["title"] if hero else f"{material.description} Lot - {qty:,} kg",
        company_id="0800", company="SKODA Auto VW India", plant="Plant Pune",
        purch_org="Purchasing Organisation LPOS (SAVWIPL)", purch_group="Scrap Sales",
        category=f"Scrap - {FAMILY_TITLES[material.family]}", category_key=material.family,
        requestor=SCRAP_REQUESTORS[i % len(SCRAP_REQUESTORS)], cost_centre="2199000",
        created=created, approval_date=created + timedelta(days=1),
        due=created + timedelta(days=14 if hero else 45), source_cart_no=None,
        hero=hero is not None, acceptable=acceptable, no_deal=stage == "handed_back",
        stage="analyzed" if acceptable else stage,
    )
    acc.events.append(event)
    _add_item(rng, vendors, event, 1, 1, desc=material.description, kind="scrap",
              qty=float(qty), unit="KG", ref=ref, incoterm="EXW", delivery_days=7, acc=acc,
              hero=hero)


def _build_sell(rng, vendors, free_ids, acc) -> None:
    lots = make_lots(rng)
    ok = [eligibility.check_value(l.qty * l.ref).eligible for l in lots]
    plan = iter(_stage_plan(rng, sum(ok), SELL_COUNTS))
    for i, (lot, eligible) in enumerate(zip(lots, ok)):
        _add_sell_event(rng, vendors, free_ids.pop(0), i=i, material=lot.material, qty=lot.qty,
                        ref=lot.ref, stage=next(plan) if eligible else "draft", acc=acc)
    from app.seed.catalog import SCRAP_MATERIALS

    h = heroes.HERO_SELL
    material = next(m for m in SCRAP_MATERIALS if m.description == h["description"])
    _add_sell_event(rng, vendors, heroes.HERO_SELL_ID, i=0, material=material, qty=h["qty"],
                    ref=float(h["ref"]), stage="draft", acc=acc, hero=h)


_SERVICE_CODES = {"25200000", "41120214", "90101500", "82121500", "78101800", "86101700"}


def build_dataset() -> Dataset:
    vendors = build_vendors(random.Random(SEED + 1))
    positions = build_positions()
    rng = random.Random(SEED + 3)
    ids = [f"EVT-2026-{n:03d}" for n in range(1, 86)]
    free = [i for i in ids if i not in (heroes.HERO_BUY_ID, heroes.HERO_SELL_ID)]
    acc = _Acc()
    _build_buy(rng, vendors, positions, free, acc)
    _build_sell(rng, vendors, free, acc)
    return Dataset(
        vendors=vendors,
        events=sorted(acc.events, key=lambda e: e.id),
        items=sorted(acc.items, key=lambda i: i.id),
        bids=sorted(acc.bids, key=lambda b: b.id),
        scripted_bids=sorted(acc.scripted, key=lambda b: b.id),
        outcomes=sorted(acc.outcomes, key=lambda o: o.item_id),
        history=build_history(random.Random(SEED + 4), vendors),
    )
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_seed_dataset.py -v`
Expected: all PASS. A failure in `test_anchor_rules`, `test_vendor_reserves` or `test_bid_counts_and_spreads` names the item id: fix the generator, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed/build.py backend/tests/test_seed_dataset.py
git commit -m "Add the dataset builder that turns carts, lots and heroes into events, items, bids and outcomes with consistency tests."
```

---

### Task 11: Seed CLI, committed data and drift test

**Files:**
- Create: `backend/scripts/seed.py`, `backend/tests/test_seed_committed.py`
- Modify: `backend/app/seed/build.py` (append `write_outputs`)
- Generate and commit: `backend/data/seed/dataset.json`, `backend/data/seed/open_shopping_cart_report.csv`

**Interfaces:**
- Produces: `write_outputs(out_dir=OUTPUT_DIR) -> None`; CLI `python scripts/seed.py`.

- [ ] **Step 1: Write the failing drift test**

```python
# file: backend/tests/test_seed_committed.py
import json

from app.importer import parse_report
from app.seed.build import OUTPUT_DIR, build_dataset, build_positions


def test_committed_dataset_matches_a_fresh_build():
    committed = json.loads((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
    fresh = json.loads(build_dataset().model_dump_json())
    assert committed == fresh


def test_committed_csv_parses_and_matches_positions():
    parsed = parse_report(OUTPUT_DIR / "open_shopping_cart_report.csv")
    assert parsed.positions == build_positions()
    assert parsed.warnings == []
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_seed_committed.py -v`
Expected: FAIL (`FileNotFoundError`).

- [ ] **Step 3: Implement and generate**

```python
# file: backend/app/seed/build.py  (append to the end of the file)
def write_outputs(out_dir: Path = OUTPUT_DIR) -> None:
    from app.importer import write_report

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "dataset.json").write_text(build_dataset().model_dump_json(indent=1),
                                          encoding="utf-8")
    write_report(build_positions(), out_dir / "open_shopping_cart_report.csv")
```

```python
# file: backend/scripts/seed.py
"""Regenerate the committed seed data: python scripts/seed.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.seed.build import OUTPUT_DIR, write_outputs  # noqa: E402

if __name__ == "__main__":
    write_outputs()
    print(f"wrote seed data to {OUTPUT_DIR}")
```

Run: `python scripts/seed.py`
Expected: prints `wrote seed data to ...backend\data\seed`.

- [ ] **Step 4: Run the whole suite**

Run: `python -m pytest -q`
Expected: all tests PASS (79 tests, verified by extracting this plan's code and running it).

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed/build.py backend/scripts/seed.py backend/tests/test_seed_committed.py backend/data/seed
git commit -m "Add the seed script and commit the generated dataset and shopping cart report, with a test that fails when they drift from the generator."
```

---

## Self-Review (done while writing)

- **Spec coverage (Phase 1 scope):** deal maths (Task 2), effective price A15 (Task 3), eligibility A17/A43 (Task 4), models (Task 5), importer with cp1252, header strip, forward-fill, shifted rows A5/A6 (Task 6), seed sizes ≥150 positions / ≥40 vendors / ≥15 scrap buyers / ≥25 lots / ≥200 history (Tasks 7 to 10), hero numbers A40/A41 with corrected floor (Tasks 8, 10), stage mix and ineligible cases, no-deal and acceptable events A9, outcomes with positive delta, CSV round trip, determinism and committed-data drift (Tasks 10, 11). Not in Phase 1 by design: lifecycle transitions, API, exporter, negotiation engine, frontend (Phases 2 to 5).
- **Placeholder scan:** none.
- **Type consistency:** `CartPosition.net_qty/net_unit_price`, `Dataset.item_bids(item_id, scripted=)`, `Event.stage` values, `pool(vendors, key)` and hero dict keys (`prices, target, limit, reserves, payment_codes, delivery_days, incoterm`) are used identically across tasks.
- **Open risk flagged for the executor:** A46 (approval date read as D/M) is inferred from five sample rows. Task 6 Step 4 says to stop if that assumption fails.
