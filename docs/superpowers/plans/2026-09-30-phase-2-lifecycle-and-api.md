# Phase 2: Lifecycle, Read Model and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Phase 1 seed data through a tested FastAPI backend: item state machine, a SQLite store, derived read models (event, item, comparison, history, vendors, dashboard), the buyer commands up to "analyzed", event simulation, and a guarantee that no vendor reserve or unreleased bid price ever leaves the backend.

**Architecture:** `store.py` keeps every model as a JSON document in one SQLite table, seeded from `backend/data/seed/dataset.json`. `readmodel.py` builds pure derived views from a `Snapshot` of the store using only `deal.py` for maths. `services.py` holds the commands (each validated by `lifecycle.py` and `eligibility.py`). `api.py` is a thin FastAPI layer whose `response_model`s make leaking `reserve` structurally impossible.

**Tech Stack:** Python 3.11, FastAPI 0.115, pydantic 2, sqlite3, pytest 8, httpx (FastAPI TestClient).

**Spec:** `docs/superpowers/specs/2026-09-29-main-negotiation-bot-design.md` (sections 2, 4, 7). Assumptions: `assumptions.txt` (A<n>). Builds on `docs/superpowers/plans/2026-09-29-phase-1-deal-core-and-seed.md` (done, 89 tests).

## Global Constraints

- All money in INR. Money maths only via `app/deal.py`; never write `direction == ...` branches outside `app/deal.py` and `app/seed/`. Sorting best-first uses `deal.best_first`.
- Derived values (value, gap, potential delta, realised delta, effective price, status) are computed on read and never stored.
- `Dataset.reserves` (vendor hidden walk-away prices) and unreleased `scripted_bid` prices must never appear in any API response. Response models are explicit pydantic classes in `app/schemas.py`.
- Bots never start on their own: Phase 2 stops at `analyzed`; `negotiating` and later states belong to Phase 4.
- Event status is derived from item states (`received` / `in_progress` / `closed`); never read `Event.stage`.
- Eligibility: default band is Phase 2 (INR 2,000 to 10,00,000, at least 3 bids) per A43.
- Item states and transitions are exactly those in Task 2. Error mapping: unknown id -> 404, rule violation or invalid transition -> 409, bad body -> 422.
- Commit messages: one short plain paragraph, no prefix, no bullets, no attribution lines.
- Run commands from `D:\main-negotiation-bot\backend`. Run pytest as `python -m pytest ... -p no:asyncio`.

## File Structure

```
backend/
  app/deal.py            (modify: points_valid, bid_spread, best_first)
  app/models.py          (modify: Objective alias)
  app/lifecycle.py       transitions + derived event status
  app/store.py           SQLite document store (Repo)
  app/schemas.py         response models
  app/readmodel.py       Snapshot + derived views + dashboard
  app/services.py        commands: set_points, confirm_points, release_bids, analyze
  app/simulate.py        Simulate Event
  app/seed/build.py      (modify: public Accumulator, add_buy_event, add_sell_event)
  app/api.py             create_app(repo)
  app/main.py            uvicorn entry (app)
  README.md              run instructions
  tests/conftest.py      seed_dataset + repo fixtures
  tests/test_*.py        one file per module
```

---

### Task 1: Deal helpers and Objective alias

**Files:**
- Modify: `backend/app/deal.py`, `backend/app/models.py`, `backend/tests/test_deal.py`

**Interfaces:**
- Produces: `deal.points_valid(direction, target, limit) -> bool`; `deal.bid_spread(prices) -> float` (fraction, `(max-min)/min`, 4 decimals); `deal.best_first(direction, values, key=identity) -> list` (best price first; stable); `models.Objective` (Literal alias, also used by `Item.objective`).

- [ ] **Step 1: Append failing tests**

```python
# file: backend/tests/test_deal.py  (append)
def test_points_valid_buy_requires_target_at_or_below_ceiling():
    assert deal.points_valid("buy", target=250, limit=270)
    assert deal.points_valid("buy", target=270, limit=270)
    assert not deal.points_valid("buy", target=280, limit=270)


def test_points_valid_sell_requires_floor_at_or_below_target():
    assert deal.points_valid("sell", target=170, limit=165)
    assert not deal.points_valid("sell", target=160, limit=165)


def test_points_valid_rejects_non_positive():
    assert not deal.points_valid("buy", target=0, limit=10)
    assert not deal.points_valid("sell", target=10, limit=-1)


def test_bid_spread():
    assert deal.bid_spread([285, 292, 312]) == 0.0947
    assert deal.bid_spread([100]) == 0.0
    with pytest.raises(ValueError):
        deal.bid_spread([0, 5])


def test_best_first_orders_by_direction_and_is_stable():
    assert deal.best_first("buy", [3, 1, 2]) == [1, 2, 3]
    assert deal.best_first("sell", [3, 1, 2]) == [3, 2, 1]
    rows = [("a", 5), ("b", 5), ("c", 4)]
    assert [r[0] for r in deal.best_first("buy", rows, key=lambda r: r[1])] == ["c", "a", "b"]
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_deal.py -q -p no:asyncio`
Expected: FAIL (`AttributeError: module 'app.deal' has no attribute 'points_valid'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/deal.py  (append)
def points_valid(direction: Direction, target: float, limit: float) -> bool:
    """Buyer's negotiation points: BUY target <= ceiling, SELL floor <= target; both positive."""
    _check(direction)
    if target <= 0 or limit <= 0:
        return False
    return target <= limit if direction == "buy" else limit <= target


def bid_spread(prices: Sequence[float]) -> float:
    """Relative gap between the highest and lowest bid: (max - min) / min."""
    if len(prices) < 2:
        return 0.0
    lo, hi = min(prices), max(prices)
    if lo <= 0:
        raise ValueError("prices must be positive")
    return round((hi - lo) / lo, 4)


def best_first(direction: Direction, values: Sequence, key=lambda v: v) -> list:
    """Sort so the best price for us comes first (lowest for buy, highest for sell)."""
    _check(direction)
    return sorted(values, key=key, reverse=direction == "sell")
```

In `backend/app/models.py`, add the alias after `Language` and use it in `Item`. Replace this block:

```python
    objective: Optional[
        Literal["reduce_price", "improve_lead_time", "improve_payment_terms",
                "improve_commercial_terms"]
    ] = None
```

with `objective: Optional[Objective] = None`, and add this line directly after the `Language = ...` line:

```python
# file: backend/app/models.py  (insert after the Language alias)
Objective = Literal["reduce_price", "improve_lead_time", "improve_payment_terms",
                    "improve_commercial_terms"]
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest -q -p no:asyncio`
Expected: all PASS (89 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/deal.py backend/app/models.py backend/tests/test_deal.py
git commit -m "Add deal helpers for negotiation point validation, bid spread and best-first ordering, and an Objective type alias."
```

---

### Task 2: Item lifecycle

**Files:**
- Create: `backend/app/lifecycle.py`, `backend/tests/test_lifecycle.py`

**Interfaces:**
- Produces: `TRANSITIONS: dict[str, frozenset[str]]`; `EventStatus`; `InvalidTransition(Exception)`; `can_transition(src, dst) -> bool`; `require_transition(src, dst) -> None`; `event_status(states) -> EventStatus`.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_lifecycle.py
import pytest

from app import lifecycle as lc
from app.models import Dataset


def test_happy_path_is_allowed_step_by_step():
    path = ["draft", "points_reviewed", "bids_in", "analyzed", "negotiating",
            "result_pending", "awaiting_approval", "closed"]
    for a, b in zip(path, path[1:]):
        assert lc.can_transition(a, b), (a, b)


def test_continue_negotiation_and_hand_back():
    assert lc.can_transition("result_pending", "negotiating")
    assert lc.can_transition("negotiating", "handed_back")
    assert lc.can_transition("handed_back", "points_reviewed")
    assert lc.can_transition("handed_back", "closed")


def test_bids_can_trickle_in():
    assert lc.can_transition("points_reviewed", "awaiting_bids")
    assert lc.can_transition("awaiting_bids", "awaiting_bids")
    assert lc.can_transition("awaiting_bids", "bids_in")


def test_illegal_transitions_are_rejected():
    for a, b in [("draft", "analyzed"), ("analyzed", "closed"), ("closed", "draft"),
                 ("bids_in", "negotiating"), ("draft", "negotiating")]:
        assert not lc.can_transition(a, b)
        with pytest.raises(lc.InvalidTransition):
            lc.require_transition(a, b)


def test_every_state_has_an_entry_and_closed_is_terminal():
    assert set(lc.TRANSITIONS) == {
        "draft", "points_reviewed", "awaiting_bids", "bids_in", "analyzed", "negotiating",
        "result_pending", "awaiting_approval", "closed", "handed_back"}
    assert lc.TRANSITIONS["closed"] == frozenset()


def test_event_status_is_derived_from_item_states():
    assert lc.event_status(["draft", "draft"]) == "received"
    assert lc.event_status(["closed", "closed"]) == "closed"
    assert lc.event_status(["closed", "analyzed"]) == "in_progress"
    assert lc.event_status(["awaiting_bids"]) == "in_progress"
    assert lc.event_status(["handed_back"]) == "in_progress"
    with pytest.raises(ValueError):
        lc.event_status([])


def test_seed_item_states_are_all_known(seed_dataset: Dataset):
    assert {i.state for i in seed_dataset.items} <= set(lc.TRANSITIONS)
```

Also create the shared fixtures now (used by this and later tests):

```python
# file: backend/tests/conftest.py
import pytest

from app.models import Dataset
from app.seed.build import OUTPUT_DIR


@pytest.fixture(scope="session")
def seed_dataset() -> Dataset:
    return Dataset.model_validate_json((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_lifecycle.py -q -p no:asyncio`
Expected: FAIL (`ImportError: cannot import name 'lifecycle'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/lifecycle.py
"""Item state machine and derived event status (spec section 4, A31 to A34)."""
from __future__ import annotations

from typing import Iterable, Literal

EventStatus = Literal["received", "in_progress", "closed"]

TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"points_reviewed"}),
    "points_reviewed": frozenset({"awaiting_bids", "bids_in"}),
    "awaiting_bids": frozenset({"awaiting_bids", "bids_in"}),
    "bids_in": frozenset({"analyzed"}),
    "analyzed": frozenset({"negotiating", "points_reviewed"}),
    "negotiating": frozenset({"result_pending", "handed_back"}),
    "result_pending": frozenset({"negotiating", "awaiting_approval", "handed_back"}),
    "awaiting_approval": frozenset({"closed", "result_pending"}),
    "handed_back": frozenset({"points_reviewed", "closed"}),
    "closed": frozenset(),
}


class InvalidTransition(Exception):
    pass


def can_transition(src: str, dst: str) -> bool:
    return dst in TRANSITIONS.get(src, frozenset())


def require_transition(src: str, dst: str) -> None:
    if not can_transition(src, dst):
        raise InvalidTransition(f"item cannot move from {src} to {dst}")


def event_status(states: Iterable[str]) -> EventStatus:
    states = list(states)
    if not states:
        raise ValueError("an event needs at least one item")
    if all(s == "closed" for s in states):
        return "closed"
    if all(s == "draft" for s in states):
        return "received"
    return "in_progress"
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_lifecycle.py -q -p no:asyncio`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/lifecycle.py backend/tests/test_lifecycle.py backend/tests/conftest.py
git commit -m "Add the item state machine with derived event status and shared test fixtures."
```

---

### Task 3: SQLite document store

**Files:**
- Create: `backend/app/store.py`, `backend/tests/test_store.py`
- Modify: `backend/tests/conftest.py` (add `repo` fixture)

**Interfaces:**
- Produces: `Repo(path=":memory:")` with `transaction()`, `put(kind, id, value, parent=None)`, `get(kind, id)`, `fetch(kind, parent=None)`, `delete(kind, id)`, `count(kind)`, `reserves() -> dict[str, float]`, `load_dataset(ds)`, `dataset() -> Dataset`, `seed_if_empty(path) -> bool`. Kinds: `vendor, event, item, bid, scripted_bid, outcome, history, reserve`. Parents: item->event id, bid/scripted_bid/outcome->item id.

- [ ] **Step 1: Write failing tests and the fixture**

```python
# file: backend/tests/conftest.py  (append)
from app.store import Repo  # noqa: E402


@pytest.fixture
def repo(seed_dataset: Dataset) -> Repo:
    r = Repo()
    r.load_dataset(seed_dataset)
    return r
```

```python
# file: backend/tests/test_store.py
import pytest

from app.models import Dataset, Item
from app.store import Repo


def test_load_and_export_round_trip(repo: Repo, seed_dataset: Dataset):
    assert repo.dataset() == seed_dataset


def test_counts(repo: Repo, seed_dataset: Dataset):
    assert repo.count("event") == len(seed_dataset.events) == 85
    assert repo.count("reserve") == len(seed_dataset.reserves)


def test_fetch_by_parent_and_order(repo: Repo, seed_dataset: Dataset):
    items = repo.fetch("item", parent="EVT-2026-041")
    assert [i.id for i in items] == [f"EVT-2026-041-0{n}" for n in range(1, 7)]
    assert repo.fetch("bid", parent="EVT-2026-041-01") == []
    assert len(repo.fetch("scripted_bid", parent="EVT-2026-041-01")) == 5


def test_get_put_delete(repo: Repo):
    item = repo.get("item", "EVT-2026-041-01")
    assert isinstance(item, Item) and item.state == "draft"
    repo.put("item", item.id, item.model_copy(update={"state": "points_reviewed"}),
             parent=item.event_id)
    assert repo.get("item", item.id).state == "points_reviewed"
    repo.delete("item", item.id)
    assert repo.get("item", item.id) is None


def test_update_keeps_order(repo: Repo):
    before = [i.id for i in repo.fetch("item")]
    item = repo.get("item", before[3])
    repo.put("item", item.id, item.model_copy(update={"state": "closed"}), parent=item.event_id)
    assert [i.id for i in repo.fetch("item")] == before


def test_new_rows_go_to_the_end(repo: Repo):
    item = repo.get("item", "EVT-2026-041-01")
    repo.put("item", "ZZZ-01", item.model_copy(update={"id": "ZZZ-01"}), parent="ZZZ")
    assert repo.fetch("item")[-1].id == "ZZZ-01"


def test_transaction_rolls_back_on_error(repo: Repo):
    with pytest.raises(RuntimeError):
        with repo.transaction():
            repo.delete("item", "EVT-2026-041-01")
            raise RuntimeError("boom")
    assert repo.get("item", "EVT-2026-041-01") is not None


def test_reserves_round_trip_as_numbers(repo: Repo, seed_dataset: Dataset):
    some = next(iter(seed_dataset.reserves))
    assert repo.reserves()[some] == seed_dataset.reserves[some]


def test_unknown_kind_is_rejected(repo: Repo):
    with pytest.raises(ValueError):
        repo.fetch("nope")


def test_file_backed_store_persists_and_seeds_once(tmp_path, seed_dataset: Dataset):
    seed_file = tmp_path / "seed.json"
    seed_file.write_text(seed_dataset.model_dump_json(), encoding="utf-8")
    db = tmp_path / "app.db"
    r1 = Repo(db)
    assert r1.seed_if_empty(seed_file) is True
    assert r1.seed_if_empty(seed_file) is False
    r1.put("item", "EVT-2026-041-01",
           r1.get("item", "EVT-2026-041-01").model_copy(update={"state": "points_reviewed"}),
           parent="EVT-2026-041")
    r2 = Repo(db)
    assert r2.get("item", "EVT-2026-041-01").state == "points_reviewed"
    assert r2.seed_if_empty(seed_file) is False
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_store.py -q -p no:asyncio`
Expected: FAIL (`ModuleNotFoundError: app.store`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/store.py
"""SQLite document store: every model is a JSON document keyed by (kind, id)."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

from app.models import Bid, Dataset, Event, HistoryRecord, Item, Outcome, Vendor

KINDS: dict[str, Any] = {
    "vendor": Vendor, "event": Event, "item": Item, "bid": Bid, "scripted_bid": Bid,
    "outcome": Outcome, "history": HistoryRecord, "reserve": None,
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    kind TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, seq INTEGER NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (kind, id));
CREATE INDEX IF NOT EXISTS docs_parent ON docs (kind, parent);
"""


class Repo:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(_SCHEMA)

    @contextmanager
    def transaction(self):
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            else:
                self._conn.execute("COMMIT")

    @staticmethod
    def _check(kind: str) -> None:
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")

    @staticmethod
    def _decode(kind: str, body: str):
        cls = KINDS[kind]
        return json.loads(body) if cls is None else cls.model_validate_json(body)

    def put(self, kind: str, id: str, value: Any, parent: Optional[str] = None) -> None:
        self._check(kind)
        body = value.model_dump_json() if isinstance(value, BaseModel) else json.dumps(value)
        with self._lock:
            self._conn.execute(
                "INSERT INTO docs (kind, id, parent, seq, body) VALUES "
                "(?, ?, ?, COALESCE((SELECT MAX(seq) FROM docs WHERE kind = ?), 0) + 1, ?) "
                "ON CONFLICT (kind, id) DO UPDATE SET "
                "parent = COALESCE(excluded.parent, parent), body = excluded.body",
                (kind, id, parent, kind, body),
            )

    def get(self, kind: str, id: str):
        self._check(kind)
        with self._lock:
            row = self._conn.execute(
                "SELECT body FROM docs WHERE kind = ? AND id = ?", (kind, id)).fetchone()
        return None if row is None else self._decode(kind, row[0])

    def fetch(self, kind: str, parent: Optional[str] = None) -> list:
        self._check(kind)
        sql, args = "SELECT body FROM docs WHERE kind = ?", [kind]
        if parent is not None:
            sql += " AND parent = ?"
            args.append(parent)
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY seq", args).fetchall()
        return [self._decode(kind, r[0]) for r in rows]

    def delete(self, kind: str, id: str) -> None:
        self._check(kind)
        with self._lock:
            self._conn.execute("DELETE FROM docs WHERE kind = ? AND id = ?", (kind, id))

    def count(self, kind: str) -> int:
        self._check(kind)
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM docs WHERE kind = ?", (kind,)).fetchone()[0]

    def reserves(self) -> dict[str, float]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, body FROM docs WHERE kind = 'reserve' ORDER BY seq").fetchall()
        return {r[0]: json.loads(r[1]) for r in rows}

    def load_dataset(self, ds: Dataset) -> None:
        with self.transaction():
            self._conn.execute("DELETE FROM docs")
            for v in ds.vendors:
                self.put("vendor", v.id, v)
            for e in ds.events:
                self.put("event", e.id, e)
            for i in ds.items:
                self.put("item", i.id, i, parent=i.event_id)
            for b in ds.bids:
                self.put("bid", b.id, b, parent=b.item_id)
            for b in ds.scripted_bids:
                self.put("scripted_bid", b.id, b, parent=b.item_id)
            for o in ds.outcomes:
                self.put("outcome", o.item_id, o, parent=o.item_id)
            for h in ds.history:
                self.put("history", h.id, h)
            for bid_id, value in ds.reserves.items():
                self.put("reserve", bid_id, value)

    def dataset(self) -> Dataset:
        return Dataset(
            vendors=self.fetch("vendor"), events=self.fetch("event"), items=self.fetch("item"),
            bids=self.fetch("bid"), scripted_bids=self.fetch("scripted_bid"),
            outcomes=self.fetch("outcome"), history=self.fetch("history"),
            reserves=self.reserves(),
        )

    def seed_if_empty(self, seed_path: str | Path) -> bool:
        if self.count("event") > 0:
            return False
        ds = Dataset.model_validate_json(Path(seed_path).read_text(encoding="utf-8"))
        self.load_dataset(ds)
        return True
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_store.py -q -p no:asyncio`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/store.py backend/tests/test_store.py backend/tests/conftest.py
git commit -m "Add the SQLite document store with transactions, parent lookups and seeding from the committed dataset."
```

---

### Task 4: Response schemas and item/event/comparison/history read models

**Files:**
- Create: `backend/app/schemas.py`, `backend/app/readmodel.py`, `backend/tests/test_readmodel.py`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `event_status`, Task 3 `Repo`.
- Produces (in `readmodel`): `Snapshot` (dataclass with `vendors`, `events`, `items`, `history`, `bids_by_item`, `scripted_by_item`, `outcomes`, plus indexes `event_by_id`, `item_by_id`, `items_by_event`); `snapshot(repo) -> Snapshot`; `points(item) -> (target, limit)`; `item_view(snap, item) -> ItemView`; `event_view(snap, event, ivs=None) -> EventView`; `event_detail(snap, event) -> EventDetail`; `comparison(snap, item) -> ComparisonView`; `history_view(snap, item) -> HistoryView`; `outcome_view(snap, outcome) -> OutcomeView`; `item_detail(snap, item) -> ItemDetail`.
- Schemas (in `schemas`): `EligibilityView, ItemView, EventView, EventDetail, ComparisonRow, ComparisonSummary, ComparisonView, HistoryPoint, HistoryStats, HistoryView, OutcomeView, Invitee, ItemDetail` (fields exactly as in the code below).

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_readmodel.py
import pytest

from app import deal, lifecycle, readmodel as rm
from app.models import Dataset
from app.store import Repo

HERO_BUY_ITEM = "EVT-2026-041-01"
HERO_SELL_EVENT = "EVT-2026-052"


@pytest.fixture
def snap(repo: Repo):
    return rm.snapshot(repo)


def test_snapshot_indexes(snap, seed_dataset: Dataset):
    assert len(snap.events) == 85 and len(snap.item_by_id) == len(seed_dataset.items)
    assert len(snap.items_by_event["EVT-2026-041"]) == 6
    assert HERO_BUY_ITEM in snap.item_by_id


def test_hero_buy_item_before_bids(snap):
    v = rm.item_view(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert v.state == "draft" and not v.points_set
    assert (v.target, v.limit) == (250, 270)  # suggested points until the buyer sets them
    assert v.bid_count == 0 and v.best_bid is None and v.potential_delta is None
    assert v.recommendation == "waiting" and v.value == 168000  # 600 x reference 280


def test_hero_sell_event_before_bids(snap):
    e = rm.event_view(snap, snap.event_by_id[HERO_SELL_EVENT])
    assert e.status == "received" and e.eligibility.eligible
    assert e.reference_value == 825000 and e.potential_delta == 0
    assert e.vendor_count == 5


def test_hero_buy_event_totals(snap):
    e = rm.event_view(snap, snap.event_by_id["EVT-2026-041"])
    assert e.item_count == 6 and e.vendor_count == 5
    assert e.reference_value == 318200 and e.quoted_value == 318200
    assert e.status == "received" and e.direction == "buy"


def test_item_views_are_consistent_with_deal_for_every_item(snap):
    for item in snap.items:
        v = rm.item_view(snap, item)
        d = snap.event_by_id[item.event_id].direction
        bids = snap.bids_by_item.get(item.id, [])
        assert v.bid_count == len(bids)
        if bids:
            best = deal.best_price(d, [b.unit_price for b in bids])
            assert v.best_bid == best
            assert v.gap == deal.gap_to_target(d, best, v.target)
            if item.state != "closed":
                assert v.potential_delta == deal.potential_delta(d, best, v.target, item.qty)
            assert v.value == deal.value(item.qty, best)
        else:
            assert v.best_bid is None and v.recommendation in ("waiting", "done")


def test_event_status_matches_lifecycle_and_closed_count(snap):
    statuses = {}
    for e in snap.events:
        ev = rm.event_view(snap, e)
        assert ev.status == lifecycle.event_status(i.state for i in snap.items_by_event[e.id])
        statuses[e.id] = ev.status
    assert sum(1 for s in statuses.values() if s == "closed") == 4


def test_ineligible_events_are_flagged(snap):
    bad = [e for e in snap.events if not rm.event_view(snap, e).eligibility.eligible]
    assert len(bad) == 7  # 4 carts + 3 lots
    assert all("value" in rm.event_view(snap, e).eligibility.reason for e in bad)


def _first_analyzed(snap, direction):
    for item in snap.items:
        e = snap.event_by_id[item.event_id]
        if item.state == "analyzed" and e.direction == direction and not e.acceptable:
            return item
    raise AssertionError("no analyzed item")


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_comparison_orders_best_effective_first(snap, direction):
    item = _first_analyzed(snap, direction)
    c = rm.comparison(snap, item)
    assert len(c.rows) >= 3 and c.summary.direction == direction
    eff = [r.effective_price for r in c.rows]
    assert eff == deal.best_first(direction, eff)
    assert sum(1 for r in c.rows if r.is_best_effective) >= 1
    best = deal.best_price(direction, [r.unit_price for r in c.rows])
    assert c.summary.best_price == best
    assert [r.unit_price for r in c.rows if r.is_best_price][0] == best
    assert c.summary.opportunity is True and c.summary.potential_delta > 0
    assert c.summary.spread == deal.bid_spread([r.unit_price for r in c.rows])


def test_comparison_of_item_without_bids_is_empty(snap):
    c = rm.comparison(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert c.rows == [] and c.summary.best_price is None and c.summary.opportunity is False


def test_history_for_hero_item_matches_by_description(snap):
    h = rm.history_view(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert h.basis == "description" and h.stats.count == 6
    assert all(262 <= r.unit_price <= 275 for r in h.records)
    assert [r.date for r in h.records] == sorted(r.date for r in h.records)
    assert h.last_negotiated is not None


def test_history_falls_back_to_category(snap):
    item = next(i for i in snap.items if i.description == "Meals For Training Batch"
                or i.event_id == "EVT-2026-041" and i.position == 2)
    h = rm.history_view(snap, snap.item_by_id["EVT-2026-041-02"])
    assert h.stats.count >= 2 and item is not None


def test_outcome_view_carries_derived_delta(snap):
    o = next(o for o in snap.outcomes.values() if o.negotiated)
    v = rm.outcome_view(snap, o)
    d = snap.event_by_id[snap.item_by_id[o.item_id].event_id].direction
    assert v.value_delta == deal.realised_delta(d, o.original_price, o.final_price, o.qty) > 0


def test_item_detail_hides_scripted_prices_and_lists_invitees(snap):
    d = rm.item_detail(snap, snap.item_by_id[HERO_BUY_ITEM])
    assert len(d.invitees) == 5 and d.comparison.rows == [] and d.outcome is None
    dumped = d.model_dump_json()
    assert "unit_price" not in dumped.split('"comparison"')[0].split('"invitees"')[1]
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_readmodel.py -q -p no:asyncio`
Expected: FAIL (`ImportError: cannot import name 'readmodel'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/schemas.py
"""Explicit API response models. Nothing here carries a vendor reserve."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

from app.models import Direction, ItemState, Language, Objective, Unit

EventStatus = Literal["received", "in_progress", "closed"]
Recommendation = Literal["waiting", "negotiate", "accept", "done"]


class EligibilityView(BaseModel):
    eligible: bool
    reason: str = ""


class ItemView(BaseModel):
    id: str
    event_id: str
    position: int
    description: str
    kind: Literal["service", "goods", "scrap"]
    qty: float
    unit: Unit
    reference_price: float
    target: float
    limit: float
    points_set: bool
    objective: Optional[Objective]
    incoterm: str
    delivery_days: int
    state: ItemState
    bid_count: int
    min_bids_met: bool
    best_bid: Optional[float]
    best_bid_vendor_id: Optional[str]
    best_bid_vendor: Optional[str]
    best_effective_price: Optional[float]
    gap: Optional[float]
    potential_delta: Optional[float]
    value: float
    recommendation: Recommendation


class EventView(BaseModel):
    id: str
    type: Literal["shopping_cart", "scrap_sale"]
    direction: Direction
    title: str
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
    status: EventStatus
    eligibility: EligibilityView
    item_count: int
    vendor_count: int
    reference_value: float
    quoted_value: float
    potential_delta: float
    realised_delta: float


class EventDetail(BaseModel):
    event: EventView
    items: list[ItemView]


class ComparisonRow(BaseModel):
    bid_id: str
    vendor_id: str
    vendor_name: str
    vendor_rating: float
    unit_price: float
    effective_price: float
    payment_code: str
    incoterm: str
    delivery_days: int
    validity_days: int
    warranty_months: int
    penalty_clause: str
    language: Language
    gap_to_target: float
    is_best_price: bool
    is_best_effective: bool


class ComparisonSummary(BaseModel):
    direction: Direction
    target: float
    limit: float
    best_price: Optional[float]
    best_effective_price: Optional[float]
    best_effective_bid_id: Optional[str]
    spread: Optional[float]
    opportunity: bool
    potential_delta: float


class ComparisonView(BaseModel):
    item_id: str
    rows: list[ComparisonRow]
    summary: ComparisonSummary


class HistoryPoint(BaseModel):
    id: str
    date: date
    description: str
    vendor_id: str
    unit_price: float
    qty: float
    negotiated: bool
    original_price: Optional[float]


class HistoryStats(BaseModel):
    count: int
    average: float
    minimum: float
    maximum: float
    last_price: float
    last_date: date


class HistoryView(BaseModel):
    item_id: str
    basis: Literal["description", "category", "none"]
    records: list[HistoryPoint]
    stats: Optional[HistoryStats]
    last_negotiated: Optional[HistoryPoint]


class OutcomeView(BaseModel):
    item_id: str
    vendor_id: str
    vendor_name: str
    direction: Direction
    qty: float
    original_price: float
    final_price: float
    value_delta: float
    negotiated: bool
    payment_code: str
    incoterm: str
    closed_date: date
    duration_minutes: int


class Invitee(BaseModel):
    vendor_id: str
    vendor_name: str
    rating: float
    language: Language


class ItemDetail(BaseModel):
    item: ItemView
    event: EventView
    invitees: list[Invitee]
    comparison: ComparisonView
    outcome: Optional[OutcomeView]
    value_eligibility: EligibilityView
    bids_eligibility: EligibilityView
```

```python
# file: backend/app/readmodel.py
"""Derived, read-only views. All maths goes through app.deal."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app import deal, eligibility, lifecycle
from app import schemas as sch
from app.models import Bid, Event, HistoryRecord, Item, Outcome, Vendor
from app.store import Repo


@dataclass
class Snapshot:
    vendors: dict[str, Vendor]
    events: list[Event]
    items: list[Item]
    history: list[HistoryRecord]
    bids_by_item: dict[str, list[Bid]]
    scripted_by_item: dict[str, list[Bid]]
    outcomes: dict[str, Outcome]
    event_by_id: dict[str, Event] = field(init=False)
    item_by_id: dict[str, Item] = field(init=False)
    items_by_event: dict[str, list[Item]] = field(init=False)

    def __post_init__(self) -> None:
        self.event_by_id = {e.id: e for e in self.events}
        self.item_by_id = {i.id: i for i in self.items}
        self.items_by_event = {e.id: [] for e in self.events}
        for i in self.items:
            self.items_by_event[i.event_id].append(i)


def _group(bids: list[Bid]) -> dict[str, list[Bid]]:
    out: dict[str, list[Bid]] = {}
    for b in bids:
        out.setdefault(b.item_id, []).append(b)
    return out


def snapshot(repo: Repo) -> Snapshot:
    return Snapshot(
        vendors={v.id: v for v in repo.fetch("vendor")},
        events=repo.fetch("event"),
        items=repo.fetch("item"),
        history=repo.fetch("history"),
        bids_by_item=_group(repo.fetch("bid")),
        scripted_by_item=_group(repo.fetch("scripted_bid")),
        outcomes={o.item_id: o for o in repo.fetch("outcome")},
    )


def points(item: Item) -> tuple[float, float]:
    """Buyer's points if set, otherwise the suggested ones."""
    return (item.target if item.target is not None else item.suggested_target,
            item.limit if item.limit is not None else item.suggested_limit)


def _vendor_name(snap: Snapshot, vendor_id: str) -> str:
    v = snap.vendors.get(vendor_id)
    return v.name if v else vendor_id


def _effective(direction: str, b: Bid) -> float:
    return deal.effective_price(
        direction, b.unit_price, payment_code=b.payment_code, incoterm=b.incoterm,
        delivery_days=b.delivery_days, warranty_months=b.warranty_months)


def _best_bid(direction: str, bids: list[Bid]) -> Optional[Bid]:
    return deal.best_first(direction, bids, key=lambda b: b.unit_price)[0] if bids else None


def event_reference_value(snap: Snapshot, event: Event) -> float:
    return round(sum(i.qty * i.reference_price for i in snap.items_by_event[event.id]), 2)


def item_view(snap: Snapshot, item: Item) -> sch.ItemView:
    d = snap.event_by_id[item.event_id].direction
    bids = snap.bids_by_item.get(item.id, [])
    target, limit = points(item)
    best = _best_bid(d, bids)
    gap = deal.gap_to_target(d, best.unit_price, target) if best else None
    if best is None:
        potential = None
    elif item.state == "closed":
        potential = 0.0
    else:
        potential = deal.potential_delta(d, best.unit_price, target, item.qty)
    if item.state == "closed":
        recommendation = "done"
    elif best is None:
        recommendation = "waiting"
    else:
        recommendation = "negotiate" if gap > 0 else "accept"
    return sch.ItemView(
        id=item.id, event_id=item.event_id, position=item.position,
        description=item.description, kind=item.kind, qty=item.qty, unit=item.unit,
        reference_price=item.reference_price, target=target, limit=limit,
        points_set=item.target is not None and item.limit is not None,
        objective=item.objective, incoterm=item.incoterm, delivery_days=item.delivery_days,
        state=item.state, bid_count=len(bids),
        min_bids_met=eligibility.check_bids(len(bids)).eligible,
        best_bid=best.unit_price if best else None,
        best_bid_vendor_id=best.vendor_id if best else None,
        best_bid_vendor=_vendor_name(snap, best.vendor_id) if best else None,
        best_effective_price=(deal.best_price(d, [_effective(d, b) for b in bids])
                              if bids else None),
        gap=gap, potential_delta=potential,
        value=deal.value(item.qty, best.unit_price if best else item.reference_price),
        recommendation=recommendation,
    )


def outcome_view(snap: Snapshot, o: Outcome) -> sch.OutcomeView:
    return sch.OutcomeView(
        item_id=o.item_id, vendor_id=o.vendor_id, vendor_name=_vendor_name(snap, o.vendor_id),
        direction=o.direction, qty=o.qty, original_price=o.original_price,
        final_price=o.final_price,
        value_delta=deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty),
        negotiated=o.negotiated, payment_code=o.payment_code, incoterm=o.incoterm,
        closed_date=o.closed_date, duration_minutes=o.duration_minutes)


def event_view(snap: Snapshot, event: Event,
               ivs: Optional[dict[str, sch.ItemView]] = None) -> sch.EventView:
    items = snap.items_by_event[event.id]
    views = [(ivs or {}).get(i.id) or item_view(snap, i) for i in items]
    vendor_ids = {b.vendor_id for i in items
                  for b in snap.bids_by_item.get(i.id, []) + snap.scripted_by_item.get(i.id, [])}
    reference = event_reference_value(snap, event)
    realised = round(sum(
        deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty)
        for i in items if (o := snap.outcomes.get(i.id))), 2)
    el = eligibility.check_value(reference)
    return sch.EventView(
        id=event.id, type=event.type, direction=event.direction, title=event.title,
        company=event.company, plant=event.plant, purch_org=event.purch_org,
        purch_group=event.purch_group, category=event.category, category_key=event.category_key,
        requestor=event.requestor, cost_centre=event.cost_centre, created=event.created,
        approval_date=event.approval_date, due=event.due, source_cart_no=event.source_cart_no,
        hero=event.hero, status=lifecycle.event_status(v.state for v in views),
        eligibility=sch.EligibilityView(eligible=el.eligible, reason=el.reason),
        item_count=len(items), vendor_count=len(vendor_ids), reference_value=reference,
        quoted_value=round(sum(v.value for v in views), 2),
        potential_delta=round(sum(v.potential_delta or 0.0 for v in views), 2),
        realised_delta=realised)


def event_detail(snap: Snapshot, event: Event) -> sch.EventDetail:
    ivs = {i.id: item_view(snap, i) for i in snap.items_by_event[event.id]}
    return sch.EventDetail(event=event_view(snap, event, ivs), items=list(ivs.values()))


def comparison(snap: Snapshot, item: Item) -> sch.ComparisonView:
    d = snap.event_by_id[item.event_id].direction
    target, limit = points(item)
    bids = snap.bids_by_item.get(item.id, [])
    eff = {b.id: _effective(d, b) for b in bids}
    prices = [b.unit_price for b in bids]
    best_price = deal.best_price(d, prices) if bids else None
    best_eff = deal.best_price(d, list(eff.values())) if bids else None
    ordered = deal.best_first(d, bids, key=lambda b: eff[b.id])
    rows = []
    for b in ordered:
        v = snap.vendors.get(b.vendor_id)
        rows.append(sch.ComparisonRow(
            bid_id=b.id, vendor_id=b.vendor_id, vendor_name=_vendor_name(snap, b.vendor_id),
            vendor_rating=v.rating if v else 0.0, unit_price=b.unit_price,
            effective_price=eff[b.id], payment_code=b.payment_code, incoterm=b.incoterm,
            delivery_days=b.delivery_days, validity_days=b.validity_days,
            warranty_months=b.warranty_months, penalty_clause=b.penalty_clause,
            language=b.language, gap_to_target=deal.gap_to_target(d, b.unit_price, target),
            is_best_price=b.unit_price == best_price, is_best_effective=eff[b.id] == best_eff))
    gap = deal.gap_to_target(d, best_price, target) if bids else 0.0
    return sch.ComparisonView(
        item_id=item.id, rows=rows,
        summary=sch.ComparisonSummary(
            direction=d, target=target, limit=limit, best_price=best_price,
            best_effective_price=best_eff,
            best_effective_bid_id=next((r.bid_id for r in rows if r.is_best_effective), None),
            spread=deal.bid_spread(prices) if len(prices) >= 2 else None,
            opportunity=gap > 0,
            potential_delta=deal.potential_delta(d, best_price, target, item.qty) if bids
            else 0.0))


def _point(h: HistoryRecord) -> sch.HistoryPoint:
    return sch.HistoryPoint(
        id=h.id, date=h.closed_date, description=h.description, vendor_id=h.vendor_id,
        unit_price=h.unit_price, qty=h.qty, negotiated=h.negotiated,
        original_price=h.original_price)


def history_view(snap: Snapshot, item: Item) -> sch.HistoryView:
    event = snap.event_by_id[item.event_id]
    same_dir = [h for h in snap.history if h.direction == event.direction]
    recs = [h for h in same_dir if h.description == item.description]
    basis = "description"
    if not recs:
        recs = [h for h in same_dir if h.category_key == event.category_key]
        basis = "category"
    if not recs:
        return sch.HistoryView(item_id=item.id, basis="none", records=[], stats=None,
                               last_negotiated=None)
    recs = sorted(recs, key=lambda h: (h.closed_date, h.id))
    prices = [h.unit_price for h in recs]
    negotiated = [h for h in recs if h.negotiated]
    return sch.HistoryView(
        item_id=item.id, basis=basis, records=[_point(h) for h in recs],
        stats=sch.HistoryStats(
            count=len(recs), average=round(sum(prices) / len(prices), 2), minimum=min(prices),
            maximum=max(prices), last_price=recs[-1].unit_price, last_date=recs[-1].closed_date),
        last_negotiated=_point(negotiated[-1]) if negotiated else None)


def item_detail(snap: Snapshot, item: Item) -> sch.ItemDetail:
    event = snap.event_by_id[item.event_id]
    invitees = []
    for b in snap.scripted_by_item.get(item.id, []):
        v = snap.vendors.get(b.vendor_id)
        invitees.append(sch.Invitee(vendor_id=b.vendor_id, vendor_name=_vendor_name(snap, b.vendor_id),
                                    rating=v.rating if v else 0.0, language=b.language))
    outcome = snap.outcomes.get(item.id)
    val = eligibility.check_value(event_reference_value(snap, event))
    n_bids = eligibility.check_bids(len(snap.bids_by_item.get(item.id, [])))
    return sch.ItemDetail(
        item=item_view(snap, item), event=event_view(snap, event), invitees=invitees,
        comparison=comparison(snap, item),
        outcome=outcome_view(snap, outcome) if outcome else None,
        value_eligibility=sch.EligibilityView(eligible=val.eligible, reason=val.reason),
        bids_eligibility=sch.EligibilityView(eligible=n_bids.eligible, reason=n_bids.reason))
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_readmodel.py -q -p no:asyncio`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/readmodel.py backend/tests/test_readmodel.py
git commit -m "Add response schemas and the derived read models for items, events, bid comparison, price history and outcomes."
```

---

### Task 5: Dashboard and vendor read models

**Files:**
- Modify: `backend/app/schemas.py` (append), `backend/app/readmodel.py` (append)
- Create: `backend/tests/test_dashboard.py`

**Interfaces:**
- Produces: schemas `Kpis, CategoryValue, VendorValue, Opportunity, Insight, Dashboard, VendorView, VendorBidRow, VendorDetail`; `readmodel.dashboard(snap) -> Dashboard`; `readmodel.vendor_view(snap, vendor) -> VendorView`; `readmodel.vendor_detail(snap, vendor) -> VendorDetail`.
- KPI definitions (all derived): `total_events`; `open_events` (status != closed); `items`; `vendors` (all vendors); `total_value` (sum of event `quoted_value`); `potential_savings` (BUY items not closed with live bids, sum of `potential_delta`); `potential_uplift` (same for SELL); `potential_total`; `negotiations_in_progress` (items in negotiating, result_pending, awaiting_approval); `completed_negotiations` (outcomes with `negotiated`); `realised_savings` (BUY outcomes delta); `realised_uplift` (SELL); `realised_total`.

- [ ] **Step 1: Write failing tests (independent recomputation from the raw dataset)**

```python
# file: backend/tests/test_dashboard.py
from collections import defaultdict

import pytest

from app import deal, readmodel as rm
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def dash(repo: Repo):
    return rm.dashboard(rm.snapshot(repo))


def test_counts(dash, seed_dataset: Dataset):
    k = dash.kpis
    assert k.total_events == 85 and k.items == len(seed_dataset.items)
    assert k.vendors == 46
    assert k.open_events == 81 and len(dash.events) == 85


def test_completed_and_realised_match_independent_recomputation(dash, seed_dataset: Dataset):
    direction = {e.id: e.direction for e in seed_dataset.events}
    item_event = {i.id: i.event_id for i in seed_dataset.items}
    buy = sell = 0.0
    completed = 0
    for o in seed_dataset.outcomes:
        delta = deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty)
        assert direction[item_event[o.item_id]] == o.direction
        if o.negotiated:
            completed += 1
        if o.direction == "buy":
            buy += delta
        else:
            sell += delta
    k = dash.kpis
    assert k.completed_negotiations == completed
    assert k.realised_savings == round(buy, 2) and k.realised_uplift == round(sell, 2)
    assert k.realised_total == round(buy + sell, 2)
    assert dash.delta_generated.savings == k.realised_savings
    assert dash.delta_generated.uplift == k.realised_uplift


def test_potential_matches_independent_recomputation(dash, seed_dataset: Dataset):
    by_event = {e.id: e for e in seed_dataset.events}
    pot = defaultdict(float)
    for i in seed_dataset.items:
        bids = seed_dataset.item_bids(i.id)
        if not bids or i.state == "closed":
            continue
        d = by_event[i.event_id].direction
        best = deal.best_price(d, [b.unit_price for b in bids])
        target = i.target if i.target is not None else i.suggested_target
        pot[d] += deal.potential_delta(d, best, target, i.qty)
    k = dash.kpis
    assert k.potential_savings == round(pot["buy"], 2)
    assert k.potential_uplift == round(pot["sell"], 2)
    assert k.potential_total == round(pot["buy"] + pot["sell"], 2)
    assert k.potential_total > 0


def test_negotiations_in_progress(dash, seed_dataset: Dataset):
    n = sum(1 for i in seed_dataset.items
            if i.state in ("negotiating", "result_pending", "awaiting_approval"))
    assert dash.kpis.negotiations_in_progress == n == 2


def test_value_by_category_sums_to_total_value(dash):
    assert round(sum(c.value for c in dash.value_by_category), 2) == dash.kpis.total_value
    assert abs(sum(c.share for c in dash.value_by_category) - 1.0) < 0.001
    values = [c.value for c in dash.value_by_category]
    assert values == sorted(values, reverse=True)


def test_top_vendors_are_sorted_and_use_live_bids_only(dash, seed_dataset: Dataset):
    assert 1 <= len(dash.top_vendors) <= 5
    values = [v.value for v in dash.top_vendors]
    assert values == sorted(values, reverse=True)
    qty = {i.id: i.qty for i in seed_dataset.items}
    per_vendor = defaultdict(float)
    for b in seed_dataset.bids:
        per_vendor[b.vendor_id] += qty[b.item_id] * b.unit_price
    top = dash.top_vendors[0]
    assert top.value == round(per_vendor[top.vendor_id], 2)
    assert top.value == max(round(v, 2) for v in per_vendor.values())


def test_opportunities_only_from_live_bids_and_sorted(dash):
    assert dash.opportunities
    deltas = [o.potential_delta for o in dash.opportunities]
    assert deltas == sorted(deltas, reverse=True) and all(d > 0 for d in deltas)
    assert all(o.state in ("bids_in", "analyzed", "points_reviewed", "awaiting_bids")
               for o in dash.opportunities)
    assert "EVT-2026-041-01" not in {o.item_id for o in dash.opportunities}


def test_status_distribution(dash):
    s = dash.status_distribution
    assert s["received"] + s["in_progress"] + s["closed"] == 85 and s["closed"] == 4


def test_insight_names_the_widest_bid_spread(dash):
    assert dash.insight is not None and dash.insight.spread > 0.05


def test_vendor_views(repo: Repo):
    snap = rm.snapshot(repo)
    vendors = [rm.vendor_view(snap, v) for v in snap.vendors.values()]
    assert len(vendors) == 46
    assert sum(v.live_bid_count for v in vendors) == len(repo.fetch("bid"))
    v = next(v for v in snap.vendors.values() if v.type == "supplier")
    detail = rm.vendor_detail(snap, v)
    assert detail.vendor.id == v.id
    assert all(h.vendor_id == v.id for h in detail.history)
    assert len(detail.recent_bids) <= 20
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_dashboard.py -q -p no:asyncio`
Expected: FAIL (`AttributeError: module 'app.readmodel' has no attribute 'dashboard'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/schemas.py  (append)
class Kpis(BaseModel):
    total_events: int
    open_events: int
    items: int
    vendors: int
    total_value: float
    potential_savings: float
    potential_uplift: float
    potential_total: float
    negotiations_in_progress: int
    completed_negotiations: int
    realised_savings: float
    realised_uplift: float
    realised_total: float


class CategoryValue(BaseModel):
    category: str
    category_key: str
    value: float
    share: float


class VendorValue(BaseModel):
    vendor_id: str
    vendor_name: str
    value: float
    share: float


class Opportunity(BaseModel):
    event_id: str
    item_id: str
    title: str
    description: str
    direction: Direction
    state: ItemState
    best_bid: float
    target: float
    gap: float
    potential_delta: float


class Insight(BaseModel):
    event_id: str
    item_id: str
    description: str
    direction: Direction
    spread: float
    best_price: float
    worst_price: float


class DeltaGenerated(BaseModel):
    savings: float
    uplift: float
    total: float


class Dashboard(BaseModel):
    kpis: Kpis
    events: list[EventView]
    value_by_category: list[CategoryValue]
    top_vendors: list[VendorValue]
    opportunities: list[Opportunity]
    status_distribution: dict[str, int]
    item_state_distribution: dict[str, int]
    delta_generated: DeltaGenerated
    insight: Optional[Insight]


class VendorView(BaseModel):
    id: str
    name: str
    sap_no: str
    type: Literal["supplier", "scrap_buyer"]
    categories: list[str]
    rating: float
    payment_pref: str
    past_deals: int
    live_bid_count: int
    quoted_value: float
    closed_deals: int
    history_deals: int


class VendorBidRow(BaseModel):
    item_id: str
    event_id: str
    description: str
    unit_price: float
    qty: float


class VendorDetail(BaseModel):
    vendor: VendorView
    history: list[HistoryPoint]
    recent_bids: list[VendorBidRow]
```

```python
# file: backend/app/readmodel.py  (append)
from collections import defaultdict  # noqa: E402

_IN_PROGRESS = ("negotiating", "result_pending", "awaiting_approval")


def dashboard(snap: Snapshot) -> sch.Dashboard:
    ivs = {i.id: item_view(snap, i) for i in snap.items}
    evs = sorted((event_view(snap, e, ivs) for e in snap.events),
                 key=lambda e: (e.created, e.id), reverse=True)
    direction = {e.id: e.direction for e in snap.events}

    potential: dict[str, float] = defaultdict(float)
    for i in snap.items:
        iv = ivs[i.id]
        if iv.potential_delta:
            potential[direction[i.event_id]] += iv.potential_delta
    realised: dict[str, float] = defaultdict(float)
    for o in snap.outcomes.values():
        realised[o.direction] += deal.realised_delta(
            o.direction, o.original_price, o.final_price, o.qty)

    total_value = round(sum(e.quoted_value for e in evs), 2)
    kpis = sch.Kpis(
        total_events=len(evs), open_events=sum(1 for e in evs if e.status != "closed"),
        items=len(snap.items), vendors=len(snap.vendors), total_value=total_value,
        potential_savings=round(potential["buy"], 2), potential_uplift=round(potential["sell"], 2),
        potential_total=round(potential["buy"] + potential["sell"], 2),
        negotiations_in_progress=sum(1 for i in snap.items if i.state in _IN_PROGRESS),
        completed_negotiations=sum(1 for o in snap.outcomes.values() if o.negotiated),
        realised_savings=round(realised["buy"], 2), realised_uplift=round(realised["sell"], 2),
        realised_total=round(realised["buy"] + realised["sell"], 2))

    by_cat: dict[tuple[str, str], float] = defaultdict(float)
    for e in evs:
        by_cat[(e.category, e.category_key)] += e.quoted_value
    categories = [
        sch.CategoryValue(category=c, category_key=k, value=round(v, 2),
                          share=round(v / total_value, 4) if total_value else 0.0)
        for (c, k), v in sorted(by_cat.items(), key=lambda kv: -kv[1])]

    per_vendor: dict[str, float] = defaultdict(float)
    for i in snap.items:
        for b in snap.bids_by_item.get(i.id, []):
            per_vendor[b.vendor_id] += i.qty * b.unit_price
    vendor_total = sum(per_vendor.values())
    top_vendors = [
        sch.VendorValue(vendor_id=vid, vendor_name=_vendor_name(snap, vid), value=round(v, 2),
                        share=round(v / vendor_total, 4) if vendor_total else 0.0)
        for vid, v in sorted(per_vendor.items(), key=lambda kv: -kv[1])[:5]]

    titles = {e.id: e.title for e in snap.events}
    opportunities = sorted(
        (sch.Opportunity(
            event_id=iv.event_id, item_id=iv.id, title=titles[iv.event_id],
            description=iv.description, direction=direction[iv.event_id], state=iv.state,
            best_bid=iv.best_bid, target=iv.target, gap=iv.gap, potential_delta=iv.potential_delta)
         for iv in ivs.values()
         if iv.recommendation == "negotiate" and iv.state in
         ("points_reviewed", "awaiting_bids", "bids_in", "analyzed") and iv.bid_count > 0),
        key=lambda o: -o.potential_delta)[:8]

    insight = None
    best_spread = 0.0
    for i in snap.items:
        prices = [b.unit_price for b in snap.bids_by_item.get(i.id, [])]
        if len(prices) >= 3 and (s := deal.bid_spread(prices)) > best_spread:
            best_spread = s
            insight = sch.Insight(
                event_id=i.event_id, item_id=i.id, description=i.description,
                direction=direction[i.event_id], spread=s,
                best_price=deal.best_price(direction[i.event_id], prices),
                worst_price=deal.best_first(direction[i.event_id], prices)[-1])

    status_counts: dict[str, int] = defaultdict(int)
    for e in evs:
        status_counts[e.status] += 1
    state_counts: dict[str, int] = defaultdict(int)
    for i in snap.items:
        state_counts[i.state] += 1
    return sch.Dashboard(
        kpis=kpis, events=evs, value_by_category=categories, top_vendors=top_vendors,
        opportunities=opportunities,
        status_distribution={s: status_counts.get(s, 0) for s in ("received", "in_progress", "closed")},
        item_state_distribution=dict(sorted(state_counts.items())),
        delta_generated=sch.DeltaGenerated(
            savings=kpis.realised_savings, uplift=kpis.realised_uplift, total=kpis.realised_total),
        insight=insight)


def vendor_view(snap: Snapshot, v: Vendor) -> sch.VendorView:
    live = [(snap.item_by_id[b.item_id], b) for bids in snap.bids_by_item.values()
            for b in bids if b.vendor_id == v.id]
    return sch.VendorView(
        id=v.id, name=v.name, sap_no=v.sap_no, type=v.type, categories=v.categories,
        rating=v.rating, payment_pref=v.payment_pref, past_deals=v.past_deals,
        live_bid_count=len(live), quoted_value=round(sum(i.qty * b.unit_price for i, b in live), 2),
        closed_deals=sum(1 for o in snap.outcomes.values() if o.vendor_id == v.id),
        history_deals=sum(1 for h in snap.history if h.vendor_id == v.id))


def vendor_detail(snap: Snapshot, v: Vendor) -> sch.VendorDetail:
    history = sorted((h for h in snap.history if h.vendor_id == v.id),
                     key=lambda h: (h.closed_date, h.id), reverse=True)
    bids = [sch.VendorBidRow(item_id=i.id, event_id=i.event_id, description=i.description,
                             unit_price=b.unit_price, qty=i.qty)
            for bids in snap.bids_by_item.values() for b in bids if b.vendor_id == v.id
            for i in [snap.item_by_id[b.item_id]]]
    return sch.VendorDetail(vendor=vendor_view(snap, v), history=[_point(h) for h in history],
                            recent_bids=bids[:20])
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_dashboard.py -q -p no:asyncio`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/readmodel.py backend/tests/test_dashboard.py
git commit -m "Add the dashboard read model with KPIs, category and vendor breakdowns, opportunities and the vendor views."
```

---

### Task 6: Buyer commands (points, confirm, release bids, analyze)

**Files:**
- Create: `backend/app/services.py`, `backend/tests/test_services.py`

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces: `NotFound(LookupError)`, `Conflict(Exception)`; `set_points(repo, item_id, *, target, limit, objective=None) -> Item`; `confirm_points(repo, item_id) -> Item`; `release_bids(repo, item_id, vendor_ids=None) -> Item`; `analyze(repo, item_id) -> Item`. Each command persists the updated item and raises `Conflict` for rule violations and `lifecycle.InvalidTransition` for illegal state moves.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_services.py
import pytest

from app import lifecycle, services as sv
from app import readmodel as rm
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


def _state(repo, item_id):
    return repo.get("item", item_id).state


def test_set_points_stores_target_limit_and_objective(repo: Repo):
    item = sv.set_points(repo, BUY, target=250, limit=270, objective="reduce_price")
    assert (item.target, item.limit, item.objective) == (250, 270, "reduce_price")
    assert repo.get("item", BUY).target == 250 and _state(repo, BUY) == "draft"


def test_set_points_is_direction_aware(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, BUY, target=280, limit=270)  # buy target above ceiling
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, SELL, target=160, limit=165)  # sell target below floor
    assert sv.set_points(repo, SELL, target=170, limit=165).limit == 165


def test_confirm_needs_points_first(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.confirm_points(repo, BUY)


def test_confirm_moves_to_points_reviewed_once(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    assert sv.confirm_points(repo, BUY).state == "points_reviewed"
    with pytest.raises(lifecycle.InvalidTransition):
        sv.confirm_points(repo, BUY)


def test_points_cannot_change_after_analysis(repo: Repo):
    _walk_to_analyzed(repo, BUY, 250, 270)
    with pytest.raises(sv.Conflict):
        sv.set_points(repo, BUY, target=251, limit=270)


def test_release_before_confirm_is_rejected(repo: Repo):
    with pytest.raises(sv.Conflict):
        sv.release_bids(repo, BUY)


def test_partial_release_waits_for_minimum_bids(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    invitees = [b.vendor_id for b in repo.fetch("scripted_bid", parent=BUY)]
    item = sv.release_bids(repo, BUY, invitees[:2])
    assert item.state == "awaiting_bids" and len(repo.fetch("bid", parent=BUY)) == 2
    assert len(repo.fetch("scripted_bid", parent=BUY)) == 3
    item = sv.release_bids(repo, BUY, invitees[2:3])
    assert item.state == "bids_in"  # third bid meets the minimum of 3


def test_release_all_defaults_and_keeps_reserves(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    reserves_before = repo.reserves()
    assert sv.release_bids(repo, BUY).state == "bids_in"
    assert repo.fetch("scripted_bid", parent=BUY) == []
    assert repo.reserves() == reserves_before


def test_release_unknown_vendor_is_rejected(repo: Repo):
    sv.set_points(repo, BUY, target=250, limit=270)
    sv.confirm_points(repo, BUY)
    with pytest.raises(sv.Conflict):
        sv.release_bids(repo, BUY, ["V999"])


def _walk_to_analyzed(repo, item_id, target, limit):
    sv.set_points(repo, item_id, target=target, limit=limit, objective="reduce_price")
    sv.confirm_points(repo, item_id)
    sv.release_bids(repo, item_id)
    return sv.analyze(repo, item_id)


def test_hero_buy_walks_to_analyzed_with_expected_opportunity(repo: Repo):
    assert _walk_to_analyzed(repo, BUY, 250, 270).state == "analyzed"
    view = rm.item_view(rm.snapshot(repo), repo.get("item", BUY))
    assert (view.best_bid, view.gap, view.potential_delta) == (285, 35, 21000)
    assert view.recommendation == "negotiate" and view.points_set


def test_hero_sell_walks_to_analyzed_with_expected_opportunity(repo: Repo):
    _walk_to_analyzed(repo, SELL, 170, 165)
    view = rm.item_view(rm.snapshot(repo), repo.get("item", SELL))
    assert (view.best_bid, view.gap, view.potential_delta) == (163, 7, 35000)


def test_analyze_needs_bids_in(repo: Repo):
    with pytest.raises(lifecycle.InvalidTransition):
        sv.analyze(repo, BUY)


def test_ineligible_event_cannot_be_confirmed(repo: Repo):
    snap = rm.snapshot(repo)
    bad = next(e for e in snap.events if not rm.event_view(snap, e).eligibility.eligible)
    item = snap.items_by_event[bad.id][0]
    sv.set_points(repo, item.id, target=item.suggested_target, limit=item.suggested_limit)
    with pytest.raises(sv.Conflict) as exc:
        sv.confirm_points(repo, item.id)
    assert "value" in str(exc.value)


def test_unknown_item_is_not_found(repo: Repo):
    with pytest.raises(sv.NotFound):
        sv.set_points(repo, "NOPE", target=1, limit=2)
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_services.py -q -p no:asyncio`
Expected: FAIL (`ImportError: cannot import name 'services'`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/services.py
"""Buyer commands. Each validates rules, then persists. No negotiation logic (Phase 4)."""
from __future__ import annotations

from typing import Optional

from app import deal, eligibility, lifecycle
from app.models import Item, Objective
from app.store import Repo


class NotFound(LookupError):
    pass


class Conflict(Exception):
    pass


def _item(repo: Repo, item_id: str) -> Item:
    item = repo.get("item", item_id)
    if item is None:
        raise NotFound(f"item {item_id} not found")
    return item


def _save(repo: Repo, item: Item) -> Item:
    repo.put("item", item.id, item, parent=item.event_id)
    return item


def _direction(repo: Repo, item: Item) -> str:
    return repo.get("event", item.event_id).direction


def _reference_value(repo: Repo, event_id: str) -> float:
    return sum(i.qty * i.reference_price for i in repo.fetch("item", parent=event_id))


def set_points(repo: Repo, item_id: str, *, target: float, limit: float,
               objective: Optional[Objective] = None) -> Item:
    item = _item(repo, item_id)
    if item.state not in ("draft", "points_reviewed"):
        raise Conflict(f"points can no longer be changed in state {item.state}")
    direction = _direction(repo, item)
    if not deal.points_valid(direction, target, limit):
        raise Conflict(
            f"target {target} and limit {limit} are inconsistent for a {direction} event "
            f"({'target must not exceed the ceiling' if direction == 'buy' else 'the floor must not exceed the target'})")
    return _save(repo, item.model_copy(update={"target": target, "limit": limit,
                                                "objective": objective}))


def confirm_points(repo: Repo, item_id: str) -> Item:
    item = _item(repo, item_id)
    if item.target is None or item.limit is None:
        raise Conflict("set target and limit before confirming")
    check = eligibility.check_value(_reference_value(repo, item.event_id))
    if not check.eligible:
        raise Conflict(f"not eligible for negotiation: {check.reason}")
    lifecycle.require_transition(item.state, "points_reviewed")
    return _save(repo, item.model_copy(update={"state": "points_reviewed"}))


def release_bids(repo: Repo, item_id: str, vendor_ids: Optional[list[str]] = None) -> Item:
    item = _item(repo, item_id)
    if item.state not in ("points_reviewed", "awaiting_bids"):
        raise Conflict(f"bids cannot be released in state {item.state}")
    pending = repo.fetch("scripted_bid", parent=item_id)
    if vendor_ids is not None:
        unknown = set(vendor_ids) - {b.vendor_id for b in pending}
        if unknown:
            raise Conflict(f"no pending response from: {', '.join(sorted(unknown))}")
    chosen = [b for b in pending if vendor_ids is None or b.vendor_id in vendor_ids]
    if not chosen:
        raise Conflict("no pending vendor responses to release")
    with repo.transaction():
        for b in chosen:
            repo.put("bid", b.id, b, parent=item_id)
            repo.delete("scripted_bid", b.id)
        live = len(repo.fetch("bid", parent=item_id))
        new_state = "bids_in" if eligibility.check_bids(live).eligible else "awaiting_bids"
        lifecycle.require_transition(item.state, new_state)
        return _save(repo, item.model_copy(update={"state": new_state}))


def analyze(repo: Repo, item_id: str) -> Item:
    item = _item(repo, item_id)
    lifecycle.require_transition(item.state, "analyzed")
    return _save(repo, item.model_copy(update={"state": "analyzed"}))
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest tests/test_services.py -q -p no:asyncio`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services.py backend/tests/test_services.py
git commit -m "Add the buyer commands for setting and confirming points, releasing vendor bids and analysing quotes, with direction-aware validation."
```

---

### Task 7: Simulate Event

**Files:**
- Modify: `backend/app/seed/build.py` (rename to public names, add a parameter)
- Create: `backend/app/simulate.py`, `backend/tests/test_simulate.py`

**Interfaces:**
- Produces: in `app.seed.build`: `Accumulator` (was `_Acc`), `add_buy_event` (was `_add_buy_event`), `add_sell_event` (was `_add_sell_event`, gains `created_days_ago: int | None = None`); in `app.simulate`: `simulate_event(repo, direction) -> str` (new event id; always `draft`, always eligible, scripted bids and reserves stored, no live bids).

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_simulate.py
import pytest

from app import eligibility, readmodel as rm
from app.simulate import simulate_event
from app.store import Repo


@pytest.mark.parametrize("direction", ["buy", "sell"])
def test_simulated_event_is_a_fresh_eligible_draft(repo: Repo, direction):
    before_reserves = len(repo.reserves())
    event_id = simulate_event(repo, direction)
    assert event_id == "EVT-2026-086"
    snap = rm.snapshot(repo)
    ev = rm.event_view(snap, snap.event_by_id[event_id])
    assert ev.direction == direction and ev.status == "received" and ev.eligibility.eligible
    assert eligibility.check_value(ev.reference_value).eligible
    items = snap.items_by_event[event_id]
    assert items and all(i.state == "draft" and i.target is None for i in items)
    for i in items:
        scripted = snap.scripted_by_item[i.id]
        assert 3 <= len(scripted) <= 6 and snap.bids_by_item.get(i.id) is None
    assert len(repo.reserves()) > before_reserves


def test_two_simulations_get_distinct_ids_and_content(repo: Repo):
    a = simulate_event(repo, "buy")
    b = simulate_event(repo, "buy")
    assert (a, b) == ("EVT-2026-086", "EVT-2026-087")
    snap = rm.snapshot(repo)
    assert snap.event_by_id[a].title != snap.event_by_id[b].title


def test_simulation_is_deterministic_for_the_same_starting_state(seed_dataset):
    ids = []
    for _ in range(2):
        r = Repo()
        r.load_dataset(seed_dataset)
        eid = simulate_event(r, "sell")
        ids.append((eid, r.get("event", eid).title, r.fetch("item", parent=eid)[0].qty))
    assert ids[0] == ids[1]


def test_unknown_direction_is_rejected(repo: Repo):
    with pytest.raises(ValueError):
        simulate_event(repo, "swap")
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_simulate.py -q -p no:asyncio`
Expected: FAIL (`ModuleNotFoundError: app.simulate`).

- [ ] **Step 3: Implement**

In `backend/app/seed/build.py` apply these exact renames everywhere in the file (definitions and call sites): `_Acc` to `Accumulator`, `_add_buy_event` to `add_buy_event`, `_add_sell_event` to `add_sell_event`. Then change the `add_sell_event` signature and its `created` line as follows.

Replace:

```python
def add_sell_event(rng, vendors, event_id: str, *, i: int, material, qty: int, ref: float,
                    stage: str, acc: Accumulator, hero: dict | None = None) -> None:
    acceptable = stage == "acceptable"
    created = TODAY - timedelta(days=2 if hero else 23 + (i * 13) % 42)
```

(indentation of the continuation line may differ; the renamed function is what you edit) with:

```python
def add_sell_event(rng, vendors, event_id: str, *, i: int, material, qty: int, ref: float,
                   stage: str, acc: Accumulator, hero: dict | None = None,
                   created_days_ago: int | None = None) -> None:
    acceptable = stage == "acceptable"
    days_ago = created_days_ago if created_days_ago is not None else (
        2 if hero else 23 + (i * 13) % 42)
    created = TODAY - timedelta(days=days_ago)
```

The committed dataset must not change: run `python -m pytest tests/test_seed_committed.py -q -p no:asyncio` after the rename to confirm.

```python
# file: backend/app/simulate.py
"""Simulate Event: create a fresh, eligible draft event from the seed generators (A36)."""
from __future__ import annotations

import random
from datetime import timedelta

from app import eligibility
from app.seed.build import Accumulator, add_buy_event, add_sell_event
from app.seed.carts import make_position
from app.seed.catalog import BUY_CATEGORIES, REQUESTORS, SCRAP_MATERIALS
from app.seed.constants import SEED, TODAY
from app.seed.pricing import round_price
from app.store import Repo


def _next_number(repo: Repo) -> int:
    return max(int(e.id.rsplit("-", 1)[1]) for e in repo.fetch("event")) + 1


def _buy(rng: random.Random, vendors, event_id: str, n: int, acc: Accumulator) -> None:
    cat = BUY_CATEGORIES[n % len(BUY_CATEGORIES)]
    for _ in range(50):
        picks = []
        for t in rng.sample(cat.templates, min(2, len(cat.templates))):
            picks.append((t, rng.randint(t.qty_lo, t.qty_hi), rng.randint(t.price_lo, t.price_hi)))
        total = sum(q * p for _, q, p in picks)
        if eligibility.check_value(total).eligible and total <= 350_000:
            break
    else:
        picks = [(t, t.qty_lo, t.price_lo) for t in cat.templates[:2]]
    created = TODAY - timedelta(days=3)
    positions = [
        make_position(cart_no=str(1012400000 + n), pos=pos, description=t.description, cat=cat,
                      unit=t.unit, qty=q, price=p, created=created, order_for=("0800", "Plant Pune"),
                      requestor=rng.choice(REQUESTORS), cost_centre="2176000")
        for pos, (t, q, p) in enumerate(picks, start=1)]
    add_buy_event(rng, vendors, event_id, positions, "draft", acc)


def _sell(rng: random.Random, vendors, event_id: str, n: int, acc: Accumulator) -> None:
    material = SCRAP_MATERIALS[n % len(SCRAP_MATERIALS)]
    ref = round_price(rng.uniform(material.price_lo, material.price_hi))
    value = rng.uniform(40_000, 850_000)
    qty = max(10, round(value / ref / 10) * 10)
    add_sell_event(rng, vendors, event_id, i=n, material=material, qty=qty, ref=ref,
                   stage="draft", acc=acc, created_days_ago=2)


def simulate_event(repo: Repo, direction: str) -> str:
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")
    n = _next_number(repo)
    event_id = f"EVT-2026-{n:03d}"
    rng = random.Random(SEED + 1000 + n)
    vendors = repo.fetch("vendor")
    acc = Accumulator()
    (_buy if direction == "buy" else _sell)(rng, vendors, event_id, n, acc)
    with repo.transaction():
        for e in acc.events:
            repo.put("event", e.id, e)
        for i in acc.items:
            repo.put("item", i.id, i, parent=i.event_id)
        for b in acc.scripted:
            repo.put("scripted_bid", b.id, b, parent=b.item_id)
        for bid_id, value in acc.reserves.items():
            repo.put("reserve", bid_id, value)
    return event_id
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest -q -p no:asyncio`
Expected: everything PASS, including the untouched `test_seed_committed.py`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/seed/build.py backend/app/simulate.py backend/tests/test_simulate.py
git commit -m "Add the Simulate Event command that builds a fresh eligible draft event from the seed generators."
```

---

### Task 8: FastAPI app, leak guard, entry point and README

**Files:**
- Create: `backend/app/api.py`, `backend/app/main.py`, `backend/README.md`, `backend/tests/test_api.py`

**Interfaces:**
- Produces: `create_app(repo: Repo) -> FastAPI`; module `app.main:app` (file-backed at `NEGOTIATION_DB`, default `data/app.db`, seeded from `data/seed/dataset.json` when empty).
- Routes: `GET /api/health`, `GET /api/dashboard`, `GET /api/events` (query `q`, `direction`, `status`, `category_key`), `GET /api/events/{event_id}`, `POST /api/events/simulate` (body `{"direction": "buy"|"sell"}`), `GET /api/items/{item_id}` (ItemDetail), `GET /api/items/{item_id}/comparison`, `GET /api/items/{item_id}/history`, `PUT /api/items/{item_id}/points` (body `{"target", "limit", "objective"}`), `POST /api/items/{item_id}/confirm-points`, `POST /api/items/{item_id}/release-bids` (body `{"vendor_ids": [..] | null}`), `POST /api/items/{item_id}/analyze`, `GET /api/vendors`, `GET /api/vendors/{vendor_id}`, `POST /api/admin/reset`. Mutating item routes return `ItemDetail`.

- [ ] **Step 1: Write failing tests**

```python
# file: backend/tests/test_api.py
import re

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo

BUY = "EVT-2026-041-01"
SELL = "EVT-2026-052-01"


@pytest.fixture
def client(repo: Repo):
    return TestClient(create_app(repo, seed_dataset=None))


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_dashboard_shape(client):
    d = client.get("/api/dashboard").json()
    assert d["kpis"]["total_events"] == 85 and len(d["events"]) == 85
    assert set(d["status_distribution"]) == {"received", "in_progress", "closed"}


def test_event_list_filters(client):
    all_events = client.get("/api/events").json()
    assert len(all_events) == 85
    sells = client.get("/api/events", params={"direction": "sell"}).json()
    assert sells and all(e["direction"] == "sell" for e in sells) and len(sells) == 25
    closed = client.get("/api/events", params={"status": "closed"}).json()
    assert len(closed) == 4
    hit = client.get("/api/events", params={"q": "aluminium turnings"}).json()
    assert any(e["id"] == "EVT-2026-052" for e in hit)
    assert client.get("/api/events", params={"direction": "swap"}).status_code == 422


def test_event_detail_and_404(client):
    d = client.get("/api/events/EVT-2026-041").json()
    assert d["event"]["item_count"] == 6 and len(d["items"]) == 6
    assert client.get("/api/events/NOPE").status_code == 404
    assert client.get("/api/items/NOPE").status_code == 404
    assert client.get("/api/vendors/NOPE").status_code == 404


def test_hero_buy_flow_over_http(client):
    d = client.get(f"/api/items/{BUY}").json()
    assert d["item"]["state"] == "draft" and len(d["invitees"]) == 5
    assert d["comparison"]["rows"] == []  # unreleased bid prices stay hidden

    r = client.put(f"/api/items/{BUY}/points",
                   json={"target": 280, "limit": 270, "objective": "reduce_price"})
    assert r.status_code == 409  # ceiling below target is inconsistent for a buy
    r = client.put(f"/api/items/{BUY}/points",
                   json={"target": 250, "limit": 270, "objective": "reduce_price"})
    assert r.status_code == 200 and r.json()["item"]["points_set"]
    assert client.post(f"/api/items/{BUY}/release-bids", json={}).status_code == 409
    r = client.post(f"/api/items/{BUY}/confirm-points")
    assert r.status_code == 200 and r.json()["item"]["state"] == "points_reviewed"

    vendors = [i["vendor_id"] for i in d["invitees"]]
    r = client.post(f"/api/items/{BUY}/release-bids", json={"vendor_ids": vendors[:2]})
    assert r.json()["item"]["state"] == "awaiting_bids"
    assert r.json()["bids_eligibility"]["eligible"] is False
    r = client.post(f"/api/items/{BUY}/release-bids", json={"vendor_ids": None})
    assert r.json()["item"]["state"] == "bids_in"
    assert client.post(f"/api/items/{BUY}/confirm-points").status_code == 409

    r = client.post(f"/api/items/{BUY}/analyze")
    body = r.json()
    assert r.status_code == 200 and body["item"]["state"] == "analyzed"
    assert body["comparison"]["summary"]["best_price"] == 285
    assert body["comparison"]["summary"]["potential_delta"] == 21000
    assert body["item"]["recommendation"] == "negotiate"
    assert client.post(f"/api/items/{BUY}/analyze").status_code == 409

    dash = client.get("/api/dashboard").json()
    assert BUY in {o["item_id"] for o in dash["opportunities"]}


def test_hero_sell_flow_over_http(client):
    client.put(f"/api/items/{SELL}/points", json={"target": 170, "limit": 165})
    client.post(f"/api/items/{SELL}/confirm-points")
    client.post(f"/api/items/{SELL}/release-bids", json={})
    body = client.post(f"/api/items/{SELL}/analyze").json()
    assert body["comparison"]["summary"]["best_price"] == 163
    assert body["comparison"]["summary"]["potential_delta"] == 35000


def test_history_and_comparison_routes(client):
    h = client.get(f"/api/items/{BUY}/history").json()
    assert h["basis"] == "description" and h["stats"]["count"] == 6
    c = client.get(f"/api/items/{BUY}/comparison").json()
    assert c["rows"] == []


def test_simulate_and_reset(client):
    r = client.post("/api/events/simulate", json={"direction": "sell"})
    assert r.status_code == 200 and r.json()["event"]["id"] == "EVT-2026-086"
    assert client.get("/api/dashboard").json()["kpis"]["total_events"] == 86
    assert client.post("/api/events/simulate", json={"direction": "swap"}).status_code == 422
    assert client.post("/api/admin/reset").json() == {"events": 85}
    assert client.get("/api/dashboard").json()["kpis"]["total_events"] == 85


def test_vendor_routes(client):
    vs = client.get("/api/vendors").json()
    assert len(vs) == 46
    d = client.get(f"/api/vendors/{vs[0]['id']}").json()
    assert d["vendor"]["id"] == vs[0]["id"]


def test_cors_allows_the_frontend_origin(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_no_response_ever_contains_a_reserve(client, seed_dataset: Dataset):
    paths = ["/api/dashboard", "/api/events", "/api/vendors"]
    paths += [f"/api/events/{e.id}" for e in seed_dataset.events]
    sample = seed_dataset.items[::6] + [i for i in seed_dataset.items if i.event_id in
                                        ("EVT-2026-041", "EVT-2026-052")]
    for i in sample:
        paths += [f"/api/items/{i.id}", f"/api/items/{i.id}/comparison",
                  f"/api/items/{i.id}/history"]
    paths += [f"/api/vendors/{v.id}" for v in seed_dataset.vendors[::5]]
    for p in paths:
        text = client.get(p).text
        assert "reserve" not in text.lower(), p


def test_released_prices_appear_only_after_release(client, seed_dataset: Dataset):
    scripted = [b for b in seed_dataset.scripted_bids if b.item_id == BUY]
    before = client.get(f"/api/items/{BUY}").text
    assert not any(f'"unit_price":{b.unit_price:g}' in before.replace(" ", "") for b in scripted)


def test_openapi_has_no_reserve_field(client):
    schema = client.get("/openapi.json").text
    assert not re.search(r'"reserve', schema)
```

- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_api.py -q -p no:asyncio`
Expected: FAIL (`ModuleNotFoundError: app.api`).

- [ ] **Step 3: Implement**

```python
# file: backend/app/api.py
"""FastAPI layer. Response models (app.schemas) are the only shape that leaves the backend."""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import lifecycle, readmodel, services, simulate
from app import schemas as sch
from app.models import Dataset, Direction, Objective
from app.store import Repo


class PointsIn(BaseModel):
    target: float
    limit: float
    objective: Optional[Objective] = None


class ReleaseIn(BaseModel):
    vendor_ids: Optional[list[str]] = None


class SimulateIn(BaseModel):
    direction: Direction


def create_app(repo: Repo, seed_dataset: Optional[Dataset] = None) -> FastAPI:
    """seed_dataset is only used by /api/admin/reset; pass None to reset from the repo's own
    initial export (captured now)."""
    initial = seed_dataset or repo.dataset()
    app = FastAPI(title="Main Negotiation Bot API")
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(services.NotFound)
    async def _not_found(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(services.Conflict)
    async def _conflict(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(lifecycle.InvalidTransition)
    async def _invalid(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    def snap() -> readmodel.Snapshot:
        return readmodel.snapshot(repo)

    def detail(item_id: str) -> sch.ItemDetail:
        s = snap()
        if item_id not in s.item_by_id:
            raise services.NotFound(f"item {item_id} not found")
        return readmodel.item_detail(s, s.item_by_id[item_id])

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/dashboard", response_model=sch.Dashboard)
    def dashboard():
        return readmodel.dashboard(snap())

    @app.get("/api/events", response_model=list[sch.EventView])
    def events(q: Optional[str] = None, direction: Optional[Direction] = None,
               status: Optional[sch.EventStatus] = None, category_key: Optional[str] = None):
        s = snap()
        ivs = {i.id: readmodel.item_view(s, i) for i in s.items}
        out = [readmodel.event_view(s, e, ivs) for e in s.events]
        if direction:
            out = [e for e in out if e.direction == direction]
        if status:
            out = [e for e in out if e.status == status]
        if category_key:
            out = [e for e in out if e.category_key == category_key]
        if q:
            needle = q.lower()
            out = [e for e in out if needle in " ".join(
                [e.id, e.title, e.category, e.requestor]).lower()]
        return sorted(out, key=lambda e: (e.created, e.id), reverse=True)

    @app.post("/api/events/simulate", response_model=sch.EventDetail)
    def simulate_event(body: SimulateIn):
        event_id = simulate.simulate_event(repo, body.direction)
        s = snap()
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.get("/api/events/{event_id}", response_model=sch.EventDetail)
    def event(event_id: str):
        s = snap()
        if event_id not in s.event_by_id:
            raise services.NotFound(f"event {event_id} not found")
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.get("/api/items/{item_id}", response_model=sch.ItemDetail)
    def item(item_id: str):
        return detail(item_id)

    @app.get("/api/items/{item_id}/comparison", response_model=sch.ComparisonView)
    def item_comparison(item_id: str):
        return detail(item_id).comparison

    @app.get("/api/items/{item_id}/history", response_model=sch.HistoryView)
    def item_history(item_id: str):
        s = snap()
        if item_id not in s.item_by_id:
            raise services.NotFound(f"item {item_id} not found")
        return readmodel.history_view(s, s.item_by_id[item_id])

    @app.put("/api/items/{item_id}/points", response_model=sch.ItemDetail)
    def set_points(item_id: str, body: PointsIn):
        services.set_points(repo, item_id, target=body.target, limit=body.limit,
                            objective=body.objective)
        return detail(item_id)

    @app.post("/api/items/{item_id}/confirm-points", response_model=sch.ItemDetail)
    def confirm_points(item_id: str):
        services.confirm_points(repo, item_id)
        return detail(item_id)

    @app.post("/api/items/{item_id}/release-bids", response_model=sch.ItemDetail)
    def release_bids(item_id: str, body: ReleaseIn):
        services.release_bids(repo, item_id, body.vendor_ids)
        return detail(item_id)

    @app.post("/api/items/{item_id}/analyze", response_model=sch.ItemDetail)
    def analyze(item_id: str):
        services.analyze(repo, item_id)
        return detail(item_id)

    @app.get("/api/vendors", response_model=list[sch.VendorView])
    def vendors():
        s = snap()
        return [readmodel.vendor_view(s, v) for v in s.vendors.values()]

    @app.get("/api/vendors/{vendor_id}", response_model=sch.VendorDetail)
    def vendor(vendor_id: str):
        s = snap()
        if vendor_id not in s.vendors:
            raise services.NotFound(f"vendor {vendor_id} not found")
        return readmodel.vendor_detail(s, s.vendors[vendor_id])

    @app.post("/api/admin/reset")
    def reset():
        repo.load_dataset(initial)
        return {"events": repo.count("event")}

    return app
```

```python
# file: backend/app/main.py
"""Uvicorn entry point: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from pathlib import Path

from app.api import create_app
from app.seed.build import OUTPUT_DIR
from app.store import Repo

_repo = Repo(os.environ.get("NEGOTIATION_DB", str(Path(__file__).resolve().parents[1] / "data" / "app.db")))
_repo.seed_if_empty(OUTPUT_DIR / "dataset.json")
app = create_app(_repo)
```

```markdown
<!-- file: backend/README.md -->
# Negotiation bot backend

FastAPI + SQLite. The seed data is committed in `data/seed/`.

## Run

```bash
cd backend
pip install -e ".[dev]"
python -m uvicorn app.main:app --reload --port 8000
```

The first start creates `data/app.db` (git-ignored) from `data/seed/dataset.json`.
Set `NEGOTIATION_DB` to use another file. `POST /api/admin/reset` restores the seed.
API docs: http://localhost:8000/docs

## Tests

```bash
python -m pytest -q -p no:asyncio
```

## Regenerate seed data

```bash
python scripts/seed.py
```

## Rules worth knowing

- Money maths lives only in `app/deal.py`.
- Vendor reserve prices (`Dataset.reserves`) and unreleased bid prices never appear in an API response (`tests/test_api.py` scans for this).
- Item states: draft, points_reviewed, awaiting_bids, bids_in, analyzed (Phase 2); negotiating and later arrive in Phase 4.
```

Note for the implementer: the README block above starts with an HTML comment line `<!-- file: ... -->` as a marker; it is not part of the file.

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest -q -p no:asyncio`
Expected: everything PASS. Then smoke-run the real server once: `python -m uvicorn app.main:app --port 8000` (stop it after `curl http://localhost:8000/api/health` returns `{"status":"ok"}`); make sure `data/app.db` is not staged.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api.py backend/app/main.py backend/README.md backend/tests/test_api.py
git commit -m "Add the FastAPI layer with dashboard, event, item, vendor and buyer command routes, plus tests that no reserve or unreleased bid price is ever returned."
```

---

## Self-Review

- **Spec coverage (Phase 2 scope):** state machine and derived event status (Task 2), SQLite store seeded from the committed dataset (Task 3), event/item/comparison/history/outcome views with best/target/gap/potential and eligibility (Task 4), dashboard KPIs, category donut, top vendors, opportunities, status distribution, savings/uplift generated and insight (Task 5), buyer commands to `analyzed` with direction-aware validation and the minimum-bids rule (Task 6), Simulate Event (Task 7), routes, CORS, reset and the reserve/unreleased-price guard (Task 8). Not in Phase 2 by design: sessions, negotiation engine, approval and close, export (Phases 4 and 5).
- **Placeholder scan:** none.
- **Type consistency:** `Snapshot` fields, `sch.*` names, `services` signatures and `Repo` kinds are used identically across tasks; `Objective` alias introduced in Task 1 is imported by schemas, services and api.
