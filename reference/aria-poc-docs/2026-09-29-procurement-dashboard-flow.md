# Procurement Dashboard and Negotiation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a green enterprise procurement dashboard and one end-to-end flow (RFQ → quotes → comparison → opportunity → setup → live Aria negotiation → result → buyer approval → closed RFQ → dashboard savings).

**Architecture:** Backend owns one model. Catalog JSON gains multi-vendor quotes (via `alternate_vendor_quotes`) and a generated seed of 12 RFQs. A new pure module `app/pipeline.py` derives every number (best quote, gap, potential saving, KPIs). A small SQLite lifecycle store (`app/db/lifecycle.py`) records negotiation and approval state. A new FastAPI router `app/pipeline_routes.py` serves dashboard/RFQ/item/result/approve/closed views. The Next.js frontend only renders API values (no math on the client) inside a new emerald app shell; the negotiation workspace reuses the existing `startSession` / `streamChat` / `fetchVendorDemoTurn` APIs.

**Tech Stack:** FastAPI, Pydantic, SQLite, pytest; Next.js 14 (app router), React 18, Tailwind 3, lucide-react. No new dependencies (charts are hand-rolled SVG).

**Spec:** `docs/superpowers/specs/2026-09-29-procurement-dashboard-flow-design.md`

## Global Constraints

- Backend baseline: `cd backend && python -m pytest -q` must stay green (122 tests at start). Existing part ids (`headlight-lh`, etc.) and their price fields must not change; existing tests depend on them.
- All derived numbers come from `app/pipeline.py`. Frontend never recomputes money.
- Quoted value = quantity × vendor quote. Potential saving = (best quote − target) × quantity. Final saving = (original − final) × quantity.
- Opportunity threshold: gap ≥ 2.0 % of best quote (`OPPORTUNITY_MIN_GAP_PCT`).
- Buyer must click Start; negotiation never auto-starts.
- Theme tokens (light / dark) exactly: bg #F0F3F1/#0B1411; panel #FFFFFF/#121D19; raise #F6F8F7/#16231E; line #DAE1DD/#24342E; text #1A2A25/#DAE5E0; ink #0F2C24/#E3EEE9; muted #5A6B65/#92A59D; brand #0A6A4E/#6AD7A2; ok #1B7443/#6DCB93; amber #955A00/#E6AE52; red #B42318/#F08A80; info #3047A6/#9DB0FF; focus #1F63D1; soft fills brand #E1EFE7/#16302A, ok #E0F2E6/#173024, amber #FBEFD6/#33281A, red #FCE8E6/#3A201D, info #E6EAFA/#1D2440; sidebar #0E3A2F (dark #08201A), text #CFE3DA, muted #8DB2A4; font Hanken Grotesk; sidebar width 252px; radii 6/10/16px.
- Vendor-facing payloads never include target/ceiling. Pipeline endpoints are buyer-side only.
- Deviation from spec (deliberate): RFQ status `IN_REVIEW` is folded into `received` (unapproved RFQ); review is a single step. Item `SETUP` is a UI screen only, not stored. Statuses: RFQ `received | quoted | negotiating | closed`; item `no_action | opportunity | negotiating | result_pending | approved`.
- Frontend has no test runner. Verify with `npx tsc --noEmit`, `npm run build`, and browser checks.
- Commit messages: one short plain paragraph, no prefixes, no attribution lines (user CLAUDE.md rule). Only `git add` the files each task lists (working tree has unrelated uncommitted changes).

## File Structure

Backend (create): `app/pipeline.py`, `app/db/lifecycle.py`, `app/pipeline_routes.py`, `scripts/seed_rfqs.py`, `data/mock_rfqs_generated.json`, `tests/test_pipeline.py`, `tests/test_seed.py`, `tests/test_lifecycle.py`, `tests/test_pipeline_routes.py`.
Backend (modify): `app/models.py`, `app/catalog.py`, `app/main.py`, `data/mock_catalog.json`.

Frontend (create): `components/shell/{AppShell,Sidebar,Topbar,ThemeToggle}.tsx`, `components/ui-kit/{KpiCard,StatusPill,Money,DataTable,Card}.tsx`, `components/charts/{Donut,HBar}.tsx`, `components/negotiation/{useNegotiation.ts,ContextPane.tsx,ConversationPane.tsx,IntelligencePane.tsx}`, `components/pipeline/{QuoteMatrix,OpportunityCard}.tsx`, `lib/pipeline.ts`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/rfqs/page.tsx`, `app/(app)/rfq/[id]/page.tsx`, `.../item/[partId]/page.tsx`, `.../item/[partId]/setup/page.tsx`, `app/(app)/negotiate/[sessionId]/page.tsx`, `.../result/page.tsx`, `app/(app)/rfq/[id]/approve/page.tsx`, `.../closed/page.tsx`.
Frontend (modify): `app/globals.css`, `tailwind.config.js`, `app/layout.tsx`, `app/page.tsx` (delete, moved), `app/chat/page.tsx` (redirect), `app/ops/layout.tsx`, `components/OpsShell.tsx`, `app/rfq/new/page.tsx`, `app/rfq/review/page.tsx` (restyle).

---

## Phase A — Backend model

### Task 1: Model fields and vendor override

**Files:**
- Modify: `backend/app/models.py` (AlternateQuote, PartListing, BuyerConfig, ProcurementRequest)
- Modify: `backend/app/catalog.py` (`_ingest_request`, `with_buyer_overrides`)
- Test: `backend/tests/test_pipeline.py` (created here, extended in Task 2)

**Interfaces:**
- Produces: `AlternateQuote.lead_time_days: int | None`, `AlternateQuote.payment_terms: str | None`; `PartListing.seed_outcome: dict | None`; `BuyerConfig.vendor_id: str | None`, `BuyerConfig.objective: str | None`; `ProcurementRequest.category: str`, `ProcurementRequest.seed_closed: bool`; `with_buyer_overrides` swaps the negotiating vendor when `config.vendor_id` matches an alternate.

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_pipeline.py`:

```python
from app.catalog import get_part, reset, with_buyer_overrides
from app.models import BuyerConfig


def test_vendor_override_swaps_primary_and_keeps_old_primary_as_alternate():
    reset()
    listing = get_part("headlight-lh")
    alt = listing.alternate_vendor_quotes[0]
    swapped = with_buyer_overrides(listing, BuyerConfig(vendor_id=alt.vendor_id))
    assert swapped.vendor_id == alt.vendor_id
    assert swapped.vendor_quoted_unit_price == alt.unit_price
    assert any(a.vendor_id == listing.vendor_id and a.unit_price == listing.vendor_quoted_unit_price
               for a in swapped.alternate_vendor_quotes)
    assert all(a.vendor_id != alt.vendor_id for a in swapped.alternate_vendor_quotes)
    assert listing.vendor_id != alt.vendor_id  # shared record untouched


def test_unknown_vendor_id_is_ignored():
    reset()
    listing = get_part("headlight-lh")
    assert with_buyer_overrides(listing, BuyerConfig(vendor_id="nope")).vendor_id == listing.vendor_id
```

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/test_pipeline.py -v` → FAIL (`vendor_id` not a BuyerConfig field).

- [ ] **Step 3: Implement.** In `models.py`:
  - `AlternateQuote`: add `lead_time_days: int | None = None` and `payment_terms: str | None = None`.
  - `PartListing`: add `seed_outcome: dict | None = None` (shape `{"vendor_id": str, "final_price": int}`).
  - `BuyerConfig`: add `vendor_id: str | None = None` and `objective: str | None = None`.
  - `ProcurementRequest`: add `category: str = ""` and `seed_closed: bool = False`.
  In `catalog.py` `_ingest_request`, pass `category=req.get("category", "")` and `seed_closed=bool(req.get("seed_closed", False))` into the `ProcurementRequest(...)` constructor. In `with_buyer_overrides`, before building `updates`, add:

```python
    if config.vendor_id and config.vendor_id != listing.vendor_id:
        chosen = next((a for a in listing.alternate_vendor_quotes if a.vendor_id == config.vendor_id), None)
        if chosen is not None:
            others = [a for a in listing.alternate_vendor_quotes if a.vendor_id != chosen.vendor_id]
            others.append(
                AlternateQuote(
                    vendor_id=listing.vendor_id,
                    vendor_name=listing.vendor_name,
                    unit_price=listing.vendor_quoted_unit_price,
                    lead_time_days=listing.lead_time_days,
                    payment_terms=listing.payment_terms_default,
                )
            )
            updates.update(
                vendor_id=chosen.vendor_id,
                vendor_name=chosen.vendor_name,
                vendor_quoted_unit_price=chosen.unit_price,
                lead_time_days=chosen.lead_time_days or listing.lead_time_days,
                payment_terms_default=chosen.payment_terms or listing.payment_terms_default,
                alternate_vendor_quotes=others,
            )
```
  Import `AlternateQuote` from `app.models` in catalog.py. Note `updates` must be defined before this block (move the `updates: dict = {}` line above it).

- [ ] **Step 4: Run** `python -m pytest -q` (full suite) → all pass.
- [ ] **Step 5: Commit** `git add backend/app/models.py backend/app/catalog.py backend/tests/test_pipeline.py && git commit -m "Let a buyer config pick which vendor to negotiate with and carry lead time and terms on alternate quotes."`

---

### Task 2: Pipeline derivations (pure)

**Files:**
- Create: `backend/app/pipeline.py`
- Test: `backend/tests/test_pipeline.py` (append)

**Interfaces:**
- Produces:
  - `OPPORTUNITY_MIN_GAP_PCT = 2.0`
  - `Quote` dataclass `(vendor_id, vendor_name, unit_price, lead_time_days, payment_terms)`
  - `quotes_for(part) -> list[Quote]` sorted by `(unit_price, lead_time_days)`, primary + alternates, de-duplicated by vendor_id
  - `item_view(part, state: dict | None) -> dict` (shape below)
  - `rfq_view(req, item_states: dict[str, dict], rfq_state: dict | None, *, with_items=True) -> dict`
  - `dashboard_view(requests, item_states, rfq_states, company) -> dict`
- `state` dicts (from Task 5) have keys `status, vendor_id, vendor_name, original_price, final_price, session_id`.
- `item_view` keys: `part_id, request_id, name, category, quantity, quotes[{vendor_id,vendor_name,unit_price,lead_time_days,payment_terms,is_best}], vendor_count, best{vendor_id,vendor_name,unit_price}, target_unit_price, max_acceptable_unit_price, gap, gap_pct, potential_saving, is_opportunity, quoted_value, status, outcome|None` where `outcome = {vendor_id, vendor_name, original_price, final_price, savings_per_unit, total_savings, session_id}`.
- `rfq_view` keys: `request_id,title,plant,category,created_at,needed_by,approved,status,item_count,vendor_count,quoted_value,potential_savings,realized_savings,original_value,final_value,negotiated_items,items`.
- `dashboard_view` keys: `company,kpis{total_rfqs,open_rfqs,items,vendors,quoted_value,potential_savings,negotiations_in_progress,completed_negotiations,realized_savings},rfqs,value_by_category,top_vendors,opportunities,status_distribution,savings_by_rfq`.

- [ ] **Step 1: Write failing tests** (append):

```python
from app.pipeline import OPPORTUNITY_MIN_GAP_PCT, item_view, quotes_for, rfq_view, dashboard_view
from app.catalog import get_request, list_requests


def test_chassis_frame_numbers_match_demo_story():
    reset()
    part = get_part("chassis-frame-front")
    view = item_view(part, None)
    best = view["best"]
    assert best["unit_price"] == 57_800
    assert view["target_unit_price"] == 55_000
    assert view["gap"] == 2_800
    assert view["quantity"] == 20
    assert view["potential_saving"] == 56_000
    assert view["is_opportunity"] is True
    assert view["status"] == "opportunity"
    assert view["vendor_count"] == 5
    assert view["quoted_value"] == 20 * 57_800


def test_no_opportunity_when_best_is_at_or_below_target():
    reset()
    part = get_part("headlight-lh").model_copy(update={"target_unit_price": 99_999})
    view = item_view(part, None)
    assert view["gap"] == 0 and view["potential_saving"] == 0
    assert view["is_opportunity"] is False and view["status"] == "no_action"


def test_approved_state_produces_outcome_with_savings():
    reset()
    part = get_part("chassis-frame-front")
    state = dict(status="approved", vendor_id="v", vendor_name="Vendor C",
                 original_price=57_800, final_price=56_000, session_id="s1")
    view = item_view(part, state)
    assert view["status"] == "approved"
    assert view["outcome"]["savings_per_unit"] == 1_800
    assert view["outcome"]["total_savings"] == 36_000


def test_rfq_view_totals_are_consistent_with_items():
    reset()
    req = get_request("rfq-2026-041")
    view = rfq_view(req, {}, None)
    assert view["item_count"] == len(req.parts) == 6
    assert view["quoted_value"] == sum(i["quoted_value"] for i in view["items"])
    assert view["potential_savings"] == sum(i["potential_saving"] for i in view["items"] if i["is_opportunity"])
    assert view["status"] == "quoted"
    assert view["final_value"] == view["original_value"] == view["quoted_value"]


def test_dashboard_kpis_add_up():
    reset()
    dash = dashboard_view(list_requests(), {}, {}, "SKODA")
    k = dash["kpis"]
    assert k["total_rfqs"] == len(dash["rfqs"])
    assert k["quoted_value"] == sum(r["quoted_value"] for r in dash["rfqs"])
    assert k["items"] == sum(r["item_count"] for r in dash["rfqs"])
    assert sum(c["value"] for c in dash["value_by_category"]) == k["quoted_value"]
    assert sum(s["count"] for s in dash["status_distribution"]) == k["total_rfqs"]
    assert OPPORTUNITY_MIN_GAP_PCT == 2.0
```

(Task 3 seeds the data these tests rely on: `chassis-frame-front` best 57,800 with ≥4 vendors and category `"Electrical & Chassis"` on 041. Tests in this task that need that data are run after Task 4; mark them `@pytest.mark.skip` until then only if executing tasks strictly in order — otherwise implement Task 4 first. **Recommended order: 1, 2 (pure functions only, test with headlight/no-opportunity test), 3 (data), then unskip.** The executor should run tests 1, 2, 5 in this task and 3, 4, 6 after Task 3.)

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `backend/app/pipeline.py`:**

```python
"""Buyer-side pipeline read model. Pure functions: no I/O, no LLM.

Every money figure the UI shows is derived here so the client never does maths.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from app.models import PartListing, ProcurementRequest

OPPORTUNITY_MIN_GAP_PCT = 2.0
ACTIVE_ITEM_STATES = {"negotiating", "result_pending"}


@dataclass(frozen=True)
class Quote:
    vendor_id: str
    vendor_name: str
    unit_price: int
    lead_time_days: int
    payment_terms: str


def quotes_for(part: PartListing) -> list[Quote]:
    rows = [
        Quote(part.vendor_id, part.vendor_name, part.vendor_quoted_unit_price, part.lead_time_days, part.payment_terms_default)
    ]
    seen = {part.vendor_id}
    for alt in part.alternate_vendor_quotes:
        if alt.vendor_id in seen:
            continue
        seen.add(alt.vendor_id)
        rows.append(
            Quote(
                alt.vendor_id,
                alt.vendor_name,
                alt.unit_price,
                alt.lead_time_days or part.lead_time_days,
                alt.payment_terms or part.payment_terms_default,
            )
        )
    return sorted(rows, key=lambda q: (q.unit_price, q.lead_time_days))


def _outcome(state: dict | None) -> dict | None:
    if not state or state.get("final_price") is None or state.get("original_price") is None:
        return None
    return state


def item_view(part: PartListing, state: dict | None) -> dict:
    if state is None and part.seed_outcome:
        best_seed = quotes_for(part)[0]
        state = {
            "status": "approved",
            "vendor_id": part.seed_outcome["vendor_id"],
            "vendor_name": next(
                (q.vendor_name for q in quotes_for(part) if q.vendor_id == part.seed_outcome["vendor_id"]),
                best_seed.vendor_name,
            ),
            "original_price": best_seed.unit_price,
            "final_price": part.seed_outcome["final_price"],
            "session_id": None,
        }
    quotes = quotes_for(part)
    best = quotes[0]
    gap = max(0, best.unit_price - part.target_unit_price)
    gap_pct = round(gap / best.unit_price * 100, 1) if best.unit_price else 0.0
    is_opportunity = gap_pct >= OPPORTUNITY_MIN_GAP_PCT
    status = (state or {}).get("status") or ("opportunity" if is_opportunity else "no_action")
    outcome = None
    if status in {"result_pending", "approved"} and _outcome(state):
        per_unit = state["original_price"] - state["final_price"]
        outcome = {
            "vendor_id": state.get("vendor_id"),
            "vendor_name": state.get("vendor_name"),
            "original_price": state["original_price"],
            "final_price": state["final_price"],
            "savings_per_unit": per_unit,
            "total_savings": per_unit * part.quantity,
            "session_id": state.get("session_id"),
        }
    return {
        "part_id": part.part_id,
        "request_id": part.request_id,
        "name": part.part_name,
        "category": part.category,
        "quantity": part.quantity,
        "quotes": [
            {
                "vendor_id": q.vendor_id,
                "vendor_name": q.vendor_name,
                "unit_price": q.unit_price,
                "lead_time_days": q.lead_time_days,
                "payment_terms": q.payment_terms,
                "is_best": i == 0,
            }
            for i, q in enumerate(quotes)
        ],
        "vendor_count": len(quotes),
        "best": {"vendor_id": best.vendor_id, "vendor_name": best.vendor_name, "unit_price": best.unit_price},
        "target_unit_price": part.target_unit_price,
        "max_acceptable_unit_price": part.max_acceptable_unit_price,
        "gap": gap,
        "gap_pct": gap_pct,
        "potential_saving": gap * part.quantity,
        "is_opportunity": is_opportunity,
        "quoted_value": best.unit_price * part.quantity,
        "status": status,
        "outcome": outcome,
    }


def _rfq_status(req: ProcurementRequest, items: list[dict], rfq_state: dict | None) -> str:
    if req.seed_closed or (rfq_state and rfq_state.get("status") == "closed"):
        return "closed"
    if any(i["status"] in ACTIVE_ITEM_STATES for i in items):
        return "negotiating"
    return "quoted" if req.approved else "received"


def rfq_view(
    req: ProcurementRequest,
    item_states: dict[str, dict],
    rfq_state: dict | None,
    *,
    with_items: bool = True,
) -> dict:
    items = [item_view(p, item_states.get(p.part_id)) for p in req.parts]
    vendors = {q["vendor_id"] for i in items for q in i["quotes"]}
    quoted = sum(i["quoted_value"] for i in items)
    realized = sum(i["outcome"]["total_savings"] for i in items if i["status"] == "approved" and i["outcome"])
    view = {
        "request_id": req.request_id,
        "title": req.title,
        "plant": req.plant,
        "category": req.category or "Uncategorised",
        "created_at": req.created_at.isoformat(),
        "needed_by": req.needed_by,
        "approved": req.approved,
        "status": _rfq_status(req, items, rfq_state),
        "item_count": len(items),
        "vendor_count": len(vendors),
        "quoted_value": quoted,
        "potential_savings": sum(i["potential_saving"] for i in items if i["is_opportunity"] and i["status"] != "approved"),
        "realized_savings": realized,
        "original_value": quoted,
        "final_value": quoted - realized,
        "negotiated_items": sum(1 for i in items if i["status"] == "approved" and i["outcome"]),
        "duration_seconds": (rfq_state or {}).get("duration_seconds"),
        "closed_at": (rfq_state or {}).get("closed_at"),
    }
    if with_items:
        view["items"] = items
    return view


def dashboard_view(
    requests: list[ProcurementRequest],
    item_states: dict[str, dict],
    rfq_states: dict[str, dict],
    company: str,
) -> dict:
    rfqs = [rfq_view(r, item_states, rfq_states.get(r.request_id), with_items=False) for r in requests]
    full = [rfq_view(r, item_states, rfq_states.get(r.request_id)) for r in requests]
    by_category: dict[str, int] = defaultdict(int)
    by_vendor: dict[str, dict] = {}
    opportunities: list[dict] = []
    in_progress = completed = 0
    vendors: set[str] = set()
    for rfq in full:
        by_category[rfq["category"]] += rfq["quoted_value"]
        for item in rfq["items"]:
            for q in item["quotes"]:
                vendors.add(q["vendor_id"])
                row = by_vendor.setdefault(q["vendor_id"], {"vendor_id": q["vendor_id"], "vendor_name": q["vendor_name"], "value": 0})
                row["value"] += q["unit_price"] * item["quantity"]
            if item["status"] in ACTIVE_ITEM_STATES:
                in_progress += 1
            if item["status"] == "approved" and item["outcome"]:
                completed += 1
            if item["is_opportunity"] and item["status"] in {"opportunity", "negotiating"}:
                opportunities.append(
                    {**{k: item[k] for k in ("part_id", "request_id", "name", "quantity", "gap", "potential_saving", "status")},
                     "best_price": item["best"]["unit_price"], "target": item["target_unit_price"]}
                )
    opportunities.sort(key=lambda o: o["potential_saving"], reverse=True)
    statuses: dict[str, int] = defaultdict(int)
    for r in rfqs:
        statuses[r["status"]] += 1
    return {
        "company": company,
        "kpis": {
            "total_rfqs": len(rfqs),
            "open_rfqs": sum(1 for r in rfqs if r["status"] != "closed"),
            "items": sum(r["item_count"] for r in rfqs),
            "vendors": len(vendors),
            "quoted_value": sum(r["quoted_value"] for r in rfqs),
            "potential_savings": sum(r["potential_savings"] for r in rfqs),
            "negotiations_in_progress": in_progress,
            "completed_negotiations": completed,
            "realized_savings": sum(r["realized_savings"] for r in rfqs),
        },
        "rfqs": rfqs,
        "value_by_category": sorted(
            ({"category": c, "value": v} for c, v in by_category.items()), key=lambda r: r["value"], reverse=True
        ),
        "top_vendors": sorted(by_vendor.values(), key=lambda r: r["value"], reverse=True)[:5],
        "opportunities": opportunities[:5],
        "status_distribution": [{"status": s, "count": c} for s, c in statuses.items()],
        "savings_by_rfq": [
            {"request_id": r["request_id"], "title": r["title"], "savings": r["realized_savings"]}
            for r in rfqs
            if r["realized_savings"] > 0
        ],
    }
```

- [ ] **Step 4: Run** `python -m pytest tests/test_pipeline.py -v` → tests that don't depend on Task 3 data pass (no-opportunity, vendor override, dashboard sums). Data-dependent ones pass after Task 3.
- [ ] **Step 5: Commit** `git add backend/app/pipeline.py backend/tests/test_pipeline.py && git commit -m "Add pure pipeline read model for quotes, gaps, savings and dashboard totals."`

---

### Task 3: Seed data (041 enrichment + generated RFQs)

**Files:**
- Modify: `backend/data/mock_catalog.json` (rfq-2026-041 only)
- Create: `backend/scripts/seed_rfqs.py`, `backend/data/mock_rfqs_generated.json` (script output, committed)
- Modify: `backend/app/catalog.py` (`_load` also ingests generated file)
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: 12 RFQs total (041 plus 11 generated), ≥100 items, ≥30 vendors, 8 categories; 3 generated RFQs pre-closed via `seed_closed` + per-part `seed_outcome`.

- [ ] **Step 1: Write failing test** `backend/tests/test_seed.py`:

```python
from app.catalog import get_part, get_request, list_requests, reset
from app.pipeline import quotes_for

CATEGORIES = {"Electrical & Chassis", "Braking", "Engine", "Fuel System", "Suspension", "Interior", "Cooling", "Body Components"}


def test_seed_scale_and_consistency():
    reset()
    reqs = list_requests()
    assert 10 <= len(reqs) <= 15
    parts = [p for r in reqs for p in r.parts]
    assert len(parts) >= 100
    vendors = {q.vendor_id for p in parts for q in quotes_for(p)}
    assert len(vendors) >= 30
    assert {r.category for r in reqs if r.category} <= CATEGORIES
    assert len({r.category for r in reqs}) >= 7
    for p in parts:
        assert p.target_unit_price <= p.max_acceptable_unit_price
        assert p.quantity > 0 and p.vendor_quoted_unit_price > 0
        assert len({q.vendor_id for q in quotes_for(p)}) == len(quotes_for(p))  # no duplicate vendors


def test_rfq_041_supports_the_demo():
    reset()
    req = get_request("rfq-2026-041")
    assert req.category == "Electrical & Chassis" and len(req.parts) == 6
    frame = get_part("chassis-frame-front")
    qs = quotes_for(frame)
    assert qs[0].unit_price == 57_800 and len(qs) == 5  # Bharat Forge, Ramkrishna, Sundaram-Clayton, Jamna, Sona
    assert frame.target_unit_price == 55_000 and frame.quantity == 20
    assert frame.vendor_quoted_unit_price == 62_000  # existing primary unchanged


def test_seed_is_deterministic():
    from scripts.seed_rfqs import build
    assert build() == build()
```

(`scripts` must be importable: add `backend/scripts/__init__.py` if missing, or put `sys.path` handling in conftest — `conftest.py` already puts BACKEND_ROOT on `sys.path`, so `scripts.seed_rfqs` imports if `scripts/__init__.py` exists. Create it empty.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3a: Edit `mock_catalog.json` rfq-2026-041.** Add `"category": "Electrical & Chassis"` to the request. Set `target_unit_price: 55000` and `max_acceptable_unit_price: 56000` on `chassis-frame-front` (was 54000 / 59000 — the demo needs target 55,000 and ceiling 56,000; `test_deal_engine`/`test_graph` use only `headlight-lh`, verified by grep). Replace its `alternate_vendor_quotes` with four alternates: Ramkrishna Forgings 58,500 (existing), Sundaram-Clayton 57,800 (`vendor_id "sundaram-clayton"`, lead_time_days 25, payment_terms "Net 30"), Jamna Auto 60,200 (35 days, Net 30), Sona Comstar 59,600 (28 days, Net 45). The demo item has exactly 5 vendors (Bharat Forge primary 62,000, Ramkrishna 58,500, Sundaram-Clayton 57,800, Jamna 60,200, Sona 59,600). RFQ-level vendor count for 041 is left to whatever the six lines contain (>= 5).

- [ ] **Step 3b: Write `backend/scripts/seed_rfqs.py`.** Deterministic (`random.Random(2026)`), no timestamps. Contents:
  - `CATEGORY_PARTS`: dict of 8 categories → list of `(part_name, base_price, qty_range)` (≥8 parts each, prices in ₹ realistic: e.g. Braking → ("Brake Disc Front", 3400, (60, 200)), ("Master Cylinder", 5200, (40, 120)) …; Engine → ("Timing Chain Kit", 9800, (30, 90)) …; Fuel System → ("Fuel Pump Module", 6900, …); Suspension → ("Front Strut Assembly", 11800, …); Interior → ("Dashboard Assembly", 21500, …); Cooling → ("Radiator Assembly", 8700, …); Body Components → ("Front Bumper Fascia", 8400, …); Electrical & Chassis → ("Wiring Harness Engine", 14200, …)).
  - `VENDOR_POOL`: ≥45 `(vendor_id, vendor_name)` entries grouped by category affinity (each category lists 8 vendors; pools overlap between adjacent categories).
  - `build() -> dict` returns `{"requests": [...]}` with 11 RFQs ids `rfq-2026-030 … rfq-2026-040`?? — 041 exists, so use ids `rfq-2026-031 … rfq-2026-040` (10) plus `rfq-2026-042`, total generated 11. Titles, plants (`Pune`, `Aurangabad`, `Chakan`), `needed_by` dates, `category` cycling through all 8 categories (041 supplies "Electrical & Chassis"; ensure ≥7 distinct overall). 9–12 items per RFQ. For each item: pick 3–5 vendors from the category pool; each quote = `round(base * uniform(0.94, 1.10), -2)` for price (int, multiples of 100); lead_time_days from {21,25,28,30,35}; payment_terms from {"Net 30","Net 45","Net 60"}. Primary vendor = random pick among the quotes; others become `alternate_vendor_quotes` with `lead_time_days`/`payment_terms`. Compute `best = min(prices)`; `target_unit_price = round(best*0.95, -2)`, `max_acceptable_unit_price = round(best*0.97, -2)`; guarantee `target <= ceiling` and `ceiling < best` (adjust by −100 if equal). Part fields required by `PartListing`: `part_id` (`f"{rfq_num}-{slug}"`), `part_name`, `category` (spec category), `vendor_id`, `vendor_name`, `vendor_quoted_unit_price`, `quantity`, `moq` (= quantity//4 rounded), `lead_time_days`, `payment_terms_default`, `target_lead_time_days` (= lead−3), `max_acceptable_lead_time_days` (= lead+10), `preferred_payment_terms` "Net 60", `fastest_payment_terms` "Net 30", `min_warranty_months` 24, `spec_blurb` short string. Set `"approved": True` on every request (seed).
  - Pre-closed history: RFQs 031, 033, 036 get `"seed_closed": true`; in each, the first 4 items with a positive gap get `"seed_outcome": {"vendor_id": <best vendor>, "final_price": round(best - gap*0.6, -2)}` (final ≥ target).
  - `main()` writes `data/mock_rfqs_generated.json` with `json.dumps(build(), indent=2, sort_keys=True)`; `if __name__ == "__main__": main()`.
  - Category coverage: generated RFQs 031–040,042 assigned categories `[Braking, Engine, Fuel System, Suspension, Interior, Cooling, Body Components, Braking, Engine, Suspension, Electrical & Chassis]`.

- [ ] **Step 3c: Run** `cd backend && python scripts/seed_rfqs.py` and confirm the JSON is created with ≥100 total parts (`python -c "import json;d=json.load(open('data/mock_rfqs_generated.json'));print(sum(len(r['parts']) for r in d['requests']))"` ≥ 100 − 6).
- [ ] **Step 3d: Modify `catalog._load`:** after ingesting `raw["requests"]`, also ingest `packaged_data_dir()/"mock_rfqs_generated.json"` if it exists (same `_ingest_request(..., seed=True)` loop).
- [ ] **Step 4: Run** `python -m pytest -q` → all pass, including the deferred Task 2 tests. If a pre-existing test fails because request ordering or count changed (e.g. asserts `len(list_requests())`), report it to the user before changing it (CLAUDE.md rule).
- [ ] **Step 5: Commit** `git add backend/data backend/scripts/seed_rfqs.py backend/scripts/__init__.py backend/app/catalog.py backend/tests/test_seed.py backend/tests/test_pipeline.py && git commit -m "Seed twelve RFQs with multi-vendor quotes and tune the front chassis frame line for the demo."`

---

### Task 4: Lifecycle store and transitions

**Files:**
- Create: `backend/app/db/lifecycle.py`
- Test: `backend/tests/test_lifecycle.py`

**Interfaces:**
- Produces:
  - `TransitionError(ValueError)`
  - `start_negotiation(part_id, request_id, *, vendor_id, vendor_name, original_price, quantity, session_id, path=None) -> None`
  - `accept_result(part_id, *, final_price, session_id, path=None) -> None`
  - `close_rfq(request_id, part_ids, *, approved_by, path=None) -> dict` (returns rfq_state)
  - `item_states(path=None) -> dict[str, dict]`, `rfq_states(path=None) -> dict[str, dict]`
- Item state dict keys: `part_id, request_id, status, vendor_id, vendor_name, original_price, final_price, quantity, session_id, opened_at, accepted_at, approved_at, approved_by`. RFQ state keys: `request_id, status, closed_at, approved_by, duration_seconds`.

- [ ] **Step 1: Failing tests** `backend/tests/test_lifecycle.py`:

```python
import pytest

from app.db import lifecycle as lc


def _start(db, part="p1", req="r1", price=57_800, sid="s1"):
    lc.start_negotiation(part, req, vendor_id="v", vendor_name="Vendor C", original_price=price,
                         quantity=20, session_id=sid, path=db)


def test_full_happy_path(tmp_path):
    db = tmp_path / "l.db"
    _start(db)
    assert lc.item_states(path=db)["p1"]["status"] == "negotiating"
    lc.accept_result("p1", final_price=56_000, session_id="s1", path=db)
    st = lc.item_states(path=db)["p1"]
    assert st["status"] == "result_pending" and st["final_price"] == 56_000
    rfq = lc.close_rfq("r1", ["p1"], approved_by="Dhruvil", path=db)
    assert rfq["status"] == "closed" and rfq["duration_seconds"] >= 0
    assert lc.item_states(path=db)["p1"]["status"] == "approved"
    assert lc.rfq_states(path=db)["r1"]["approved_by"] == "Dhruvil"


def test_accept_requires_negotiating(tmp_path):
    db = tmp_path / "l.db"
    with pytest.raises(lc.TransitionError):
        lc.accept_result("p1", final_price=1, session_id="s", path=db)


def test_cannot_restart_after_approval(tmp_path):
    db = tmp_path / "l.db"
    _start(db)
    lc.accept_result("p1", final_price=56_000, session_id="s1", path=db)
    lc.close_rfq("r1", ["p1"], approved_by="a", path=db)
    with pytest.raises(lc.TransitionError):
        _start(db, sid="s2")


def test_restart_allowed_while_pending_continue_negotiation(tmp_path):
    db = tmp_path / "l.db"
    _start(db)
    lc.accept_result("p1", final_price=56_500, session_id="s1", path=db)
    _start(db, sid="s2")  # Continue Negotiation
    st = lc.item_states(path=db)["p1"]
    assert st["status"] == "negotiating" and st["session_id"] == "s2" and st["final_price"] is None


def test_close_blocked_while_any_item_negotiating_or_nothing_pending(tmp_path):
    db = tmp_path / "l.db"
    _start(db, "p1")
    _start(db, "p2", sid="s2")
    lc.accept_result("p1", final_price=1, session_id="s1", path=db)
    with pytest.raises(lc.TransitionError):
        lc.close_rfq("r1", ["p1", "p2"], approved_by="a", path=db)
    with pytest.raises(lc.TransitionError):
        lc.close_rfq("r9", [], approved_by="a", path=db)
```

- [ ] **Step 2: Run** → FAIL. 
- [ ] **Step 3: Implement `backend/app/db/lifecycle.py`:**

```python
"""Negotiation lifecycle store (item + RFQ state). SKODA-side only.

Same SQLite file as the audit log. Transitions are validated here so the API
layer cannot put an item into an impossible state.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.paths import audit_db_path, on_vercel

_SCHEMA = """
CREATE TABLE IF NOT EXISTS item_state (
    part_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL,
    vendor_id TEXT, vendor_name TEXT, original_price INTEGER, final_price INTEGER,
    quantity INTEGER, session_id TEXT, opened_at TEXT, accepted_at TEXT,
    approved_at TEXT, approved_by TEXT
);
CREATE TABLE IF NOT EXISTS rfq_state (
    request_id TEXT PRIMARY KEY, status TEXT NOT NULL, closed_at TEXT,
    approved_by TEXT, duration_seconds INTEGER
);
"""


class TransitionError(ValueError):
    pass


def _connect(path: Path | None = None) -> sqlite3.Connection:
    target = path or audit_db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=DELETE" if on_vercel() else "PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def start_negotiation(part_id, request_id, *, vendor_id, vendor_name, original_price, quantity, session_id, path=None):
    with _connect(path) as conn:
        row = conn.execute("SELECT status, opened_at FROM item_state WHERE part_id=?", (part_id,)).fetchone()
        if row and row["status"] == "approved":
            raise TransitionError("Item is already approved and closed.")
        opened = row["opened_at"] if row and row["opened_at"] else _now().isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO item_state (part_id, request_id, status, vendor_id, vendor_name, original_price,"
            " final_price, quantity, session_id, opened_at) VALUES (?,?,?,?,?,?,NULL,?,?,?)",
            (part_id, request_id, "negotiating", vendor_id, vendor_name, original_price, quantity, session_id, opened),
        )


def accept_result(part_id, *, final_price, session_id, path=None):
    with _connect(path) as conn:
        row = conn.execute("SELECT status FROM item_state WHERE part_id=?", (part_id,)).fetchone()
        if not row or row["status"] not in {"negotiating", "result_pending"}:
            raise TransitionError("Item is not in negotiation.")
        conn.execute(
            "UPDATE item_state SET status='result_pending', final_price=?, session_id=?, accepted_at=? WHERE part_id=?",
            (final_price, session_id, _now().isoformat(), part_id),
        )


def close_rfq(request_id, part_ids, *, approved_by, path=None) -> dict:
    with _connect(path) as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM item_state WHERE request_id=?", (request_id,))]
        if any(r["status"] == "negotiating" for r in rows):
            raise TransitionError("Finish or park every running negotiation before closing the RFQ.")
        pending = [r for r in rows if r["status"] == "result_pending" and r["part_id"] in set(part_ids)]
        if not pending:
            raise TransitionError("No accepted negotiation result to approve.")
        now = _now()
        for r in pending:
            conn.execute(
                "UPDATE item_state SET status='approved', approved_at=?, approved_by=? WHERE part_id=?",
                (now.isoformat(), approved_by, r["part_id"]),
            )
        opened = min(datetime.fromisoformat(r["opened_at"]) for r in pending if r["opened_at"])
        duration = max(0, int((now - opened).total_seconds()))
        conn.execute(
            "INSERT OR REPLACE INTO rfq_state (request_id, status, closed_at, approved_by, duration_seconds)"
            " VALUES (?,?,?,?,?)",
            (request_id, "closed", now.isoformat(), approved_by, duration),
        )
        return {"request_id": request_id, "status": "closed", "closed_at": now.isoformat(),
                "approved_by": approved_by, "duration_seconds": duration}


def item_states(path=None) -> dict[str, dict]:
    with _connect(path) as conn:
        return {r["part_id"]: dict(r) for r in conn.execute("SELECT * FROM item_state")}


def rfq_states(path=None) -> dict[str, dict]:
    with _connect(path) as conn:
        return {r["request_id"]: dict(r) for r in conn.execute("SELECT * FROM rfq_state")}
```

- [ ] **Step 4: Run** `python -m pytest tests/test_lifecycle.py -v` → PASS.
- [ ] **Step 5: Commit** `git add backend/app/db/lifecycle.py backend/tests/test_lifecycle.py && git commit -m "Add lifecycle store that validates item and RFQ state transitions."`

---

### Task 5: Pipeline routes and session hook

**Files:**
- Create: `backend/app/pipeline_routes.py`, `backend/tests/test_pipeline_routes.py`
- Modify: `backend/app/main.py` (`include_router`; hook in `start_session`)

**Interfaces:**
- Consumes: `pipeline.*`, `lifecycle.*`, `catalog.get_request/get_part/list_requests/with_buyer_overrides`, `get_store()`, `build_handover`.
- Produces endpoints (all buyer-side JSON):
  - `GET /api/pipeline/dashboard` → `dashboard_view`
  - `GET /api/pipeline/rfqs/{request_id}` → `rfq_view` (with items) — 404 if unknown
  - `GET /api/pipeline/items/{part_id}` → `item_view`
  - `GET /api/pipeline/sessions/{session_id}/result` → `{session_id, part_id, request_id, item: item_view, vendor_name, original_price, final_price, target_unit_price, max_acceptable_unit_price, savings_per_unit, total_savings, quantity, is_final, is_acceptable, case_id, rounds, history:[{round_number,vendor_offer,bot_offer,justification_tactic}], transcript}`; `is_final` = stage in `{agreement, closed}`; 409-free (returns current values while negotiating with `is_final: false`)
  - `POST /api/pipeline/items/{part_id}/accept` body `{session_id}` → `item_view`; 409 on `TransitionError`, 400 if session not final or `current_bot_offer <= 0`
  - `POST /api/pipeline/rfqs/{request_id}/approve` body `{approved_by}` → `{rfq: rfq_view}`; 409 on `TransitionError`; 400 blank approver

- [ ] **Step 1: Failing tests** `backend/tests/test_pipeline_routes.py`:

```python
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.catalog import reset
from app.db import lifecycle
from app.db.redis_client import get_store
from app.main import app
from app.models import NegotiationStage
from tests.test_deal_engine import make_session


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.db.lifecycle.audit_db_path", lambda: tmp_path / "l.db")
    reset()
    with TestClient(app) as c:
        yield c


def _final_session(part_id="chassis-frame-front", price=56_000, stage=NegotiationStage.AGREEMENT):
    s = make_session(session_id="sess-1", part_id=part_id, request_id="rfq-2026-041", stage=stage,
                     current_bot_offer=price, current_vendor_offer=price)
    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(get_store().save(s))
    return s


def test_dashboard_shape(client):
    body = client.get("/api/pipeline/dashboard").json()
    assert body["kpis"]["total_rfqs"] >= 10 and body["rfqs"] and body["value_by_category"]


def test_rfq_and_item_views(client):
    rfq = client.get("/api/pipeline/rfqs/rfq-2026-041").json()
    assert rfq["item_count"] == 6 and rfq["status"] == "quoted"
    item = client.get("/api/pipeline/items/chassis-frame-front").json()
    assert item["potential_saving"] == 56_000
    assert client.get("/api/pipeline/rfqs/nope").status_code == 404


def test_start_session_with_vendor_marks_negotiating(client):
    resp = client.post("/api/sessions", json={
        "part_id": "chassis-frame-front",
        "buyer_config": {"vendor_id": "sundaram-clayton", "target_unit_price": 55_000,
                         "max_acceptable_unit_price": 56_000},
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["listing"]["vendor_quoted_unit_price"] == 57_800
    item = client.get("/api/pipeline/items/chassis-frame-front").json()
    assert item["status"] == "negotiating"
    assert client.get("/api/pipeline/rfqs/rfq-2026-041").json()["status"] == "negotiating"


def test_full_flow_accept_approve_updates_dashboard(client):
    sid = client.post("/api/sessions", json={
        "part_id": "chassis-frame-front",
        "buyer_config": {"vendor_id": "sundaram-clayton", "target_unit_price": 55_000,
                         "max_acceptable_unit_price": 56_000},
    }).json()["session_id"]
    s = make_session(session_id=sid, part_id="chassis-frame-front", request_id="rfq-2026-041",
                     stage=NegotiationStage.AGREEMENT, current_bot_offer=56_000, current_vendor_offer=56_000)
    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(get_store().save(s))
    before = client.get("/api/pipeline/dashboard").json()["kpis"]

    result = client.get(f"/api/pipeline/sessions/{sid}/result").json()
    assert result["original_price"] == 57_800 and result["final_price"] == 56_000
    assert result["savings_per_unit"] == 1_800 and result["total_savings"] == 36_000
    assert result["is_final"] is True

    assert client.post("/api/pipeline/items/chassis-frame-front/accept", json={"session_id": sid}).status_code == 200
    assert client.post("/api/pipeline/rfqs/rfq-2026-041/approve", json={"approved_by": ""}).status_code == 400
    closed = client.post("/api/pipeline/rfqs/rfq-2026-041/approve", json={"approved_by": "Dhruvil"}).json()["rfq"]
    assert closed["status"] == "closed" and closed["realized_savings"] == 36_000
    assert closed["final_value"] == closed["original_value"] - 36_000
    assert closed["negotiated_items"] == 1

    after = client.get("/api/pipeline/dashboard").json()["kpis"]
    assert after["realized_savings"] == before["realized_savings"] + 36_000
    assert after["completed_negotiations"] == before["completed_negotiations"] + 1
    assert after["open_rfqs"] == before["open_rfqs"] - 1


def test_accept_rejects_non_final_session(client):
    sid = client.post("/api/sessions", json={"part_id": "chassis-frame-front"}).json()["session_id"]
    assert client.post("/api/pipeline/items/chassis-frame-front/accept", json={"session_id": sid}).status_code == 400
```

- [ ] **Step 2: Run** → FAIL (404s).
- [ ] **Step 3: Implement.** `backend/app/pipeline_routes.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.catalog import get_part, get_request, list_requests, with_buyer_overrides
from app.config import get_settings
from app.db import lifecycle
from app.db.redis_client import get_store
from app.pipeline import dashboard_view, item_view, rfq_view

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])
_FINAL = {"agreement", "closed"}


def _states() -> tuple[dict, dict]:
    return lifecycle.item_states(), lifecycle.rfq_states()


@router.get("/dashboard")
async def dashboard():
    items, rfqs = _states()
    return dashboard_view(list_requests(), items, rfqs, get_settings().company_name)


@router.get("/rfqs/{request_id}")
async def rfq_detail(request_id: str):
    req = get_request(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Unknown RFQ")
    items, rfqs = _states()
    return rfq_view(req, items, rfqs.get(request_id))


@router.get("/items/{part_id}")
async def item_detail(part_id: str):
    part = get_part(part_id)
    if part is None:
        raise HTTPException(status_code=404, detail="Unknown item")
    items, _ = _states()
    return item_view(part, items.get(part_id))


async def _session_or_404(session_id: str):
    session = await get_store().get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")
    return session


@router.get("/sessions/{session_id}/result")
async def session_result(session_id: str):
    session = await _session_or_404(session_id)
    part = get_part(session.part_id)
    if part is None:
        raise HTTPException(status_code=404, detail="Unknown item")
    listing = with_buyer_overrides(part, session.buyer_config)
    items, _ = _states()
    original = listing.vendor_quoted_unit_price
    final = session.current_bot_offer or original
    per_unit = original - final
    return {
        "session_id": session.session_id,
        "case_id": session.case_id,
        "part_id": session.part_id,
        "request_id": session.request_id,
        "stage": session.stage.value,
        "is_final": session.stage.value in _FINAL,
        "item": item_view(part, items.get(part.part_id)),
        "vendor_name": listing.vendor_name,
        "quantity": listing.quantity,
        "original_price": original,
        "final_price": final,
        "target_unit_price": listing.target_unit_price,
        "max_acceptable_unit_price": listing.max_acceptable_unit_price,
        "savings_per_unit": per_unit,
        "total_savings": per_unit * listing.quantity,
        "is_acceptable": final <= listing.max_acceptable_unit_price,
        "rounds": session.round_count,
        "history": [
            {
                "round_number": e.round_number,
                "vendor_offer": e.vendor_offer,
                "bot_offer": e.bot_offer,
                "justification_tactic": e.justification_tactic,
            }
            for e in session.concession_history
        ],
        "transcript": await get_store().transcript(session_id),
    }


class AcceptBody(BaseModel):
    session_id: str


@router.post("/items/{part_id}/accept")
async def accept_item(part_id: str, body: AcceptBody):
    session = await _session_or_404(body.session_id)
    if session.part_id != part_id:
        raise HTTPException(status_code=400, detail="Session does not belong to this item.")
    if session.stage.value not in _FINAL or not session.current_bot_offer:
        raise HTTPException(status_code=400, detail="The negotiation has no final price to accept yet.")
    try:
        lifecycle.accept_result(part_id, final_price=session.current_bot_offer, session_id=session.session_id)
    except lifecycle.TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    items, _ = _states()
    return item_view(get_part(part_id), items.get(part_id))


class ApproveBody(BaseModel):
    approved_by: str


@router.post("/rfqs/{request_id}/approve")
async def approve_rfq_deal(request_id: str, body: ApproveBody):
    if not body.approved_by.strip():
        raise HTTPException(status_code=400, detail="Approver name is required.")
    req = get_request(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Unknown RFQ")
    try:
        lifecycle.close_rfq(request_id, [p.part_id for p in req.parts], approved_by=body.approved_by.strip())
    except lifecycle.TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    items, rfqs = _states()
    return {"rfq": rfq_view(req, items, rfqs.get(request_id))}
```

In `main.py`: `from app.pipeline_routes import router as pipeline_router` and `app.include_router(pipeline_router)` right after the CORS middleware block. In `start_session`, after `greeting = await _run_turn(...)` add:

```python
    if parent_request is not None:
        from app.db import lifecycle
        try:
            lifecycle.start_negotiation(
                listing.part_id, listing.request_id,
                vendor_id=listing.vendor_id, vendor_name=listing.vendor_name,
                original_price=listing.vendor_quoted_unit_price, quantity=listing.quantity,
                session_id=session.session_id,
            )
        except lifecycle.TransitionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
```
(Place the lifecycle check **before** `_run_turn` so a closed item is rejected before a session is created: move the `try` block above `greeting = ...`; `listing` already has the vendor override applied at that point.)

- [ ] **Step 4: Run** `python -m pytest -q` → all pass. Existing `test_graph`/`test_audit` that call `/api/sessions` (if any) must still pass — the lifecycle write hits the real audit DB path in those tests; if a pre-existing test now fails or dirties `backend/data/aria_audit.db`, fix by monkeypatching `app.db.lifecycle.audit_db_path` in `conftest.py` via an autouse fixture to a tmp path. Run `git status backend/data` to make sure no DB file is newly tracked.
- [ ] **Step 5: Commit** `git add backend/app/pipeline_routes.py backend/app/main.py backend/tests/test_pipeline_routes.py backend/tests/conftest.py && git commit -m "Expose pipeline dashboard, RFQ, result, accept and approve endpoints and record negotiation state when a session starts."`

---

## Phase B — Frontend foundation

### Task 6: Theme tokens, fonts, Tailwind

**Files:**
- Modify: `frontend/app/globals.css`, `frontend/tailwind.config.js`, `frontend/app/layout.tsx`

- [ ] **Step 1:** In `layout.tsx` add `Hanken_Grotesk` from `next/font/google` (`variable: "--font-hanken"`, weights 400–800) and add its variable to the `<body>` className; keep existing fonts (legacy pages still use them until Task 14). Add `suppressHydrationWarning` to `<html>`.
- [ ] **Step 2:** Append to `globals.css` (below the existing rules, keeping them):

```css
:root {
  --bg: #F0F3F1; --panel: #FFFFFF; --raise: #F6F8F7; --line: #DAE1DD; --line2: #E8EDEA;
  --text: #1A2A25; --ink: #0F2C24; --muted: #5A6B65;
  --brand: #0A6A4E; --brand-soft: #E1EFE7; --ok: #1B7443; --ok-soft: #E0F2E6;
  --amber: #955A00; --amber-soft: #FBEFD6; --red: #B42318; --red-soft: #FCE8E6;
  --info: #3047A6; --info-soft: #E6EAFA; --focus: #1F63D1;
  --side: #0E3A2F; --side-t: #CFE3DA; --side-m: #8DB2A4; --side-hover: #154A3C;
}
:root[data-theme="dark"] {
  --bg: #0B1411; --panel: #121D19; --raise: #16231E; --line: #24342E; --line2: #1C2A25;
  --text: #DAE5E0; --ink: #E3EEE9; --muted: #92A59D;
  --brand: #6AD7A2; --brand-soft: #16302A; --ok: #6DCB93; --ok-soft: #173024;
  --amber: #E6AE52; --amber-soft: #33281A; --red: #F08A80; --red-soft: #3A201D;
  --info: #9DB0FF; --info-soft: #1D2440;
  --side: #08201A; --side-hover: #0F2D24;
}
.app-shell { background: var(--bg); color: var(--text); font-family: var(--font-hanken), system-ui, sans-serif; }
.app-shell :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 3:** In `tailwind.config.js` `theme.extend.colors`, add semantic keys mapped to the variables (keep legacy keys): `surface: "var(--bg)"`, `panel: "var(--panel)"`, `raise: "var(--raise)"`, `line: "var(--line)"`, `txt: "var(--text)"`, `heading: "var(--ink)"`, `muted: "var(--muted)"`, `brand: { DEFAULT: "var(--brand)", soft: "var(--brand-soft)" }`, `okay: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" }`, `warn: { DEFAULT: "var(--amber)", soft: "var(--amber-soft)" }`, `danger: { DEFAULT: "var(--red)", soft: "var(--red-soft)" }`, `info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" }`, `side: { DEFAULT: "var(--side)", text: "var(--side-t)", muted: "var(--side-m)", hover: "var(--side-hover)" }`. Add `fontFamily.hanken: ["var(--font-hanken)", "system-ui", "sans-serif"]`, `borderRadius: { s: "6px", m: "10px", l: "16px" }`, `width: { side: "252px" }`.
- [ ] **Step 4: Verify** `cd frontend && npx tsc --noEmit && npm run build` → success.
- [ ] **Step 5: Commit** `git add frontend/app/globals.css frontend/tailwind.config.js frontend/app/layout.tsx && git commit -m "Add the emerald light and dark theme tokens and Hanken Grotesk font."`

---

### Task 7: App shell and UI kit

**Files:** Create `components/shell/{AppShell,Sidebar,Topbar,ThemeToggle}.tsx`, `components/ui-kit/{Card,KpiCard,StatusPill,Money,DataTable}.tsx`, `app/(app)/layout.tsx`, `lib/pipeline.ts` (types + fetchers, Task 8 fills endpoints).

**Interfaces (Produces):**
- `AppShell({children})` — sidebar + topbar + `<main>`; wrapper has class `app-shell min-h-screen`.
- Sidebar nav: Dashboard `/`, RFQs `/rfqs`, Negotiations (link to `/rfqs`), Ops `/ops`. Active state via `usePathname`. Sidebar bg `bg-side`, width `w-side`, hidden below `lg` with a menu button (drawer).
- `ThemeToggle` — toggles `document.documentElement.dataset.theme` between `light`/`dark`, persists in `localStorage` inside try/catch.
- `KpiCard({label, value, hint?, tone?: "default"|"good"|"warn"})`.
- `StatusPill({status})` with map: received→info, quoted→brand, negotiating→warn, closed→muted/neutral, opportunity→warn, no_action→neutral, result_pending→info, approved→okay. Labels human-readable (`result_pending` → "Awaiting approval").
- `Money({value, className?})` → `formatInr` from `lib/utils`, tabular numerals. `Card({title?, action?, children})`. `DataTable<T>({columns, rows, rowKey, onRowClick?})` where `columns: {key, header, render(row), align?}[]`.

- [ ] **Step 1:** Write the components (Tailwind classes use tokens from Task 6, e.g. `bg-panel border border-line rounded-l`, sidebar `bg-side text-side-text`). `app/(app)/layout.tsx`: `import { AppShell } ...; export default function Layout({children}) { return <AppShell>{children}</AppShell>; }`.
- [ ] **Step 2:** In `lib/pipeline.ts` define TS types mirroring the API shapes in Tasks 2 and 5 (`ItemView`, `RfqView`, `Dashboard`, `ResultView`, `Quote`) and `API_BASE`-based fetchers: `fetchDashboard()`, `fetchRfq(id)`, `fetchItem(partId)`, `fetchResult(sessionId)`, `acceptItem(partId, sessionId)`, `approveDeal(requestId, approvedBy)`. Reuse `API_BASE` and `readApiError` — export them from `lib/api.ts` if not already exported (check top of file; `startSession` already uses `API_BASE`).
- [ ] **Step 3: Verify** `npx tsc --noEmit` passes.
- [ ] **Step 4: Commit** the listed files only: `git commit -m "Add the app shell, theme toggle, UI kit and pipeline API client."`

---

### Task 8: Charts

**Files:** Create `components/charts/Donut.tsx`, `components/charts/HBar.tsx`.

**Interfaces:**
- `Donut({slices: {label, value}[], centerLabel, centerValue})` — SVG circle stroke-dasharray donut, colors from a fixed 6-step palette using CSS variables (`var(--brand)`, `var(--info)`, `var(--amber)`, `var(--ok)`, `var(--red)`, `var(--muted)`), legend with `formatInr` compact (₹ lakh/crore) values and % share.
- `HBar({rows: {label, value, sub?}[], format?})` — horizontal bars, widths proportional to max; used for top vendors, opportunities, savings.

- [ ] **Step 1:** Implement (no libs). Add a `compactInr(n)` helper to `lib/utils.ts` (`≥1e7` → `₹x.xx Cr`, `≥1e5` → `₹x.xL`, else `formatInr`).
- [ ] **Step 2: Verify** `npx tsc --noEmit`.
- [ ] **Step 3: Commit** `git commit -m "Add hand-rolled donut and horizontal bar charts."`

---

## Phase C — Screens

### Task 9: Dashboard (`/`)

**Files:** Create `app/(app)/page.tsx`; delete `app/page.tsx`; create `app/(app)/rfqs/page.tsx` (same table, full list, no charts).

- [ ] **Step 1:** `page.tsx` (client component): `fetchDashboard()` on mount; error state "Start the API on :8000". Layout, top to bottom:
  1. Header: greeting text "Sourcing pipeline", subtitle with company, right side `Simulate RFQ` button → `/rfq/new` (primary brand button) and search box that filters the table client-side by RFQ id/title.
  2. Eight `KpiCard`s in a responsive grid (`grid-cols-2 md:grid-cols-4`): Total RFQs, Open RFQs, Items, Vendors, Total Quoted Value (`Money`), Potential Savings (tone warn), Negotiations In Progress, Completed Negotiations. Add a ninth inline stat "Savings generated" (`realized_savings`, tone good) inside the Savings chart card.
  3. Main grid `lg:grid-cols-[1fr_360px]`: left = RFQ `DataTable` with columns RFQ #, Title (+ plant/due sub-text), Category, Items, Vendors, Quoted Value, Potential Savings, Status (`StatusPill`), Action (`View` link to `/rfq/{id}`); row click navigates. Right column cards: RFQ Value by Category (`Donut`), Top Vendors by Quoted Value (`HBar`), Negotiation Opportunities (`HBar` of top 5, each row links to `/rfq/{request_id}/item/{part_id}`), RFQ Status Distribution (`HBar`), Savings Generated (`HBar` of `savings_by_rfq`, empty state text "No closed negotiations yet").
- [ ] **Step 2: Verify** with the preview tools: start backend (`backend/scripts/run.ps1` or `uvicorn app.main:app --port 8000` from `backend`) and `preview_start` frontend (`.claude/launch.json` config `frontend`, port 3100). Check `read_console_messages` has no errors; screenshot desktop and `resize_window` mobile + dark (`colorScheme: "dark"`). KPIs must equal API values (compare `javascript_tool` fetch of `/backend/api/pipeline/dashboard`).
- [ ] **Step 3: Commit** `git add "frontend/app/(app)" frontend/app/page.tsx && git commit -m "Build the procurement dashboard with KPIs, RFQ table and decision charts."`

---

### Task 10: RFQ detail, comparison and opportunity

**Files:** Create `app/(app)/rfq/[id]/page.tsx`, `app/(app)/rfq/[id]/item/[partId]/page.tsx`, `components/pipeline/{QuoteMatrix,OpportunityCard}.tsx`.

- [ ] **Step 1: RFQ detail page.** Header card: RFQ id (uppercase), title, plant, category, created, due, items, vendors, quoted value, status. If `status === "closed"` show a link "View closed summary" → `/rfq/{id}/closed`. If any item is `result_pending` and RFQ not closed, show banner with `Review & approve` → `/rfq/{id}/approve`. Unapproved RFQs (`status === "received"`) show a banner linking to `/rfq/review?request={id}` and disable item actions. Item table columns: Item, Qty, Vendors, Best Quote, Target, Gap, Potential Saving, Status, Action (`Compare` link to `/rfq/{id}/item/{partId}`; primary "Negotiate" label when `is_opportunity`).
- [ ] **Step 2: `QuoteMatrix({item})`** — vendors as columns sorted by price; rows Price / Lead time / Payment terms; lowest price cell tinted `bg-okay-soft`; best column header badge "Lowest quote"; extra summary column "Target" showing target price and per-vendor "gap to target" row (`unit_price - target`, negative shown as "at/below target"). "Best commercial option" = badge on the best vendor (lowest price; ties by lead time) with reason text.
- [ ] **Step 3: `OpportunityCard({item, href})`** — visible only when `item.is_opportunity && item.status in {opportunity,negotiating}`: block titled "Negotiation opportunity" with Current Best Quote, Target, Gap / unit (`gap`, `gap_pct`), Quantity, Potential Saving (`potential_saving`), and a `Start Negotiation` button linking to `.../setup`. Never triggers the AI. If `status === "negotiating"` show "Negotiation in progress" instead of the button. If `approved`, show outcome summary.
- [ ] **Step 4: Item page** composes: breadcrumb, item header, `OpportunityCard`, `QuoteMatrix`.
- [ ] **Step 5: Verify** in browser: open `/rfq/rfq-2026-041`, confirm 6 items; open Front Chassis Frame: matrix shows ₹57,800 lowest, target ₹55,000, gap ₹2,800, potential ₹56,000 (₹56,000 must match API). Console clean. 
- [ ] **Step 6: Commit** `git commit -m "Add RFQ detail, vendor quote comparison and negotiation opportunity screens."`

---

### Task 11: Negotiation setup

**Files:** Create `app/(app)/rfq/[id]/item/[partId]/setup/page.tsx`.

- [ ] **Step 1:** Load `fetchItem(partId)`. Form: Item (read-only), Quantity (read-only), Current best quote (read-only, `best.unit_price`), Target price (default `target_unit_price`), Negotiation ceiling (default `max_acceptable_unit_price`), Preferred vendor (select of `quotes`, default best vendor), Negotiation objective (radio: Reduce price / Improve lead time / Improve payment terms / Improve commercial terms). Client validation: target ≤ ceiling ≤ selected vendor quote; show inline error. Right-side "Buyer constraints" summary card: target, ceiling, walk-away note "Never shared with the vendor", potential saving at target = `(quote − target) × qty` — **display-only reuse**: ask the server instead? Exception to "no client math": this live preview is the one derived number on the client; label it "Estimate" and compute `(selectedQuote - target) * qty`. Fine because it responds to unsaved form input.
- [ ] **Step 2:** `Start AI Negotiation` calls `startSession(partId, { vendor_id, target_unit_price, max_acceptable_unit_price, objective })` (extend the `BuyerConfig` TS type in `lib/api.ts` with `vendor_id?: string | null; objective?: string | null`) and on success `router.push('/negotiate/{session_id}?part=…&rfq=…')`. Also store the greeting: put `{greeting, listing}` in `sessionStorage` under `neg:{sessionId}` (try/catch) so the workspace can render it immediately; workspace falls back to `GET /api/sessions/{id}` transcript.
- [ ] **Step 3: Verify:** submit with target 55,000 / ceiling 56,000 / vendor Sundaram-Clayton; session opens; API `/api/pipeline/items/chassis-frame-front` reports `negotiating`.
- [ ] **Step 4: Commit** `git commit -m "Add the negotiation setup screen that captures target, ceiling, vendor and objective."`

---

### Task 12: Negotiation workspace

**Files:** Create `components/negotiation/{useNegotiation.ts,ContextPane.tsx,ConversationPane.tsx,IntelligencePane.tsx}`, `app/(app)/negotiate/[sessionId]/page.tsx`.

**Interfaces:**
- `useNegotiation(sessionId)` returns `{ session, turns, insights, busy, vendorTyping, error, sendBuyerMessage(text), simulateVendor(), autoRun(), terminal }`. It wraps `streamChat`, `fetchVendorDemoTurn`; logic is lifted from `ChatWidget.tsx` (`DEMO_MAX_TURNS`, `TERMINAL` set, the vendor-turn → `streamChat(sessionId, vendor.text)` loop at lines ~140–175). Do not delete `ChatWidget`; it stays for legacy `/chat` until Task 14. Hydrate initial state from `sessionStorage["neg:{id}"]` or `GET /api/sessions/{id}` (`transcript`, `session`, `listing`).
- **Roles:** In this app the "assistant" role is Aria (buyer side); the "user" role is the vendor. The workspace renders Aria's messages as **Buyer (Aria)** and vendor messages as **Vendor**; `simulateVendor()` fetches a simulated vendor line then feeds it through `streamChat` (same as the Test flow).
- `ContextPane`: RFQ id/title, item, qty, plant, vendor, current quote, lead time, payment terms, objective (from `buyer_config`).
- `ConversationPane`: message list, `Simulate vendor reply` button (primary when it's the vendor's turn), `Auto-run` button (runs up to `DEMO_MAX_TURNS` until terminal), manual vendor-message input labelled "Enter vendor reply", stage chip. AI recommendations shown as inline "AI recommendation" blocks derived from the latest `insights` entry (`tactic`, `reasoning`).
- `IntelligencePane` (live): current vendor quote (`listing.vendor_quoted_unit_price` via `GET /api/sessions/{id}`), target, ceiling (from `buyer_config`), latest vendor offer (`session.current_vendor_offer`), Aria's counter (`current_bot_offer`), price movement (`quote − latest vendor offer`, ▼ green), potential savings so far (`(quote − offer) × qty`, labelled estimate), negotiation status (stage), AI recommendation (latest insight). Ceiling/target displayed only here (buyer-side).
- When `terminal` and stage in `agreement|closed`: show a sticky banner `Negotiation reached a result — View result` → `/negotiate/{id}/result`. If stage is `handoff`/`paused`, show reason and link back to the RFQ.

- [ ] **Step 1:** Implement hook + panes + page (3-column grid `lg:grid-cols-[280px_1fr_320px]`; collapses to tabs on mobile).
- [ ] **Step 2: Verify (integration):** from setup, run the full negotiation using `Auto-run`; confirm the stage reaches `agreement` and the price shown in the right panel matches `GET /api/sessions/{id}`. With the mock/live provider check the final price ≤ ceiling; if the run does not land at a demoable price (target ₹55,000, ceiling ₹56,000, expected final ≈ ₹56,000), inspect `backend/app/demo.py` `_DEFAULT_PERSONA` and add a `chassis-frame-front` preset (vendor opens ₹57,800, concedes to 56,500 then 56,000) — surface this to the user first per CLAUDE.md before editing `demo.py`.
- [ ] **Step 3: Commit** `git commit -m "Add the three-pane negotiation workspace backed by the existing Aria session and streaming APIs."`

---

### Task 13: Result, approval, closed

**Files:** Create `app/(app)/negotiate/[sessionId]/result/page.tsx`, `app/(app)/rfq/[id]/approve/page.tsx`, `app/(app)/rfq/[id]/closed/page.tsx`.

- [ ] **Step 1: Result page.** `fetchResult(sessionId)`. If `!is_final`, show "Negotiation still running" with link back. Card "Negotiation completed" with Original Quote, Final Quote, Target Price, Savings / Unit, Quantity, Total Savings, Vendor, all from API fields; warning banner if `!is_acceptable` ("Final price is above your ceiling"). History table (`history`: round, vendor offer, Aria offer, tactic). Buttons: `Continue Negotiation` → `/rfq/{request_id}/item/{part_id}/setup`, `Accept Deal` → `acceptItem(part_id, session_id)` then `router.push('/rfq/{request_id}/approve')`. Disable Accept when `!is_final || !is_acceptable`.
- [ ] **Step 2: Approval page.** Load `fetchRfq(id)`; list items where `status === "result_pending"` in a table (Vendor, Item, Qty, Original quote, Final price, Total value = `final_price × qty` from `outcome`, Savings). Per item expandable "Transcript" (fetch `fetchResult(outcome.session_id)` → `transcript`) and "AI recommendation" (latest insight from `GET /api/sessions/{id}/insights`). Approver name input (default "Dhruvil Patel"), button `Approve & Close RFQ` → `approveDeal` → `router.push('/rfq/{id}/closed')`. Error text from 409 detail (e.g. still-running negotiation).
- [ ] **Step 3: Closed page.** `fetchRfq(id)` shows: Original RFQ Value (`original_value`), Final Negotiated Value (`final_value`), Total Savings (`realized_savings`, % of original), Items Negotiated `${negotiated_items} / ${item_count}`, Vendors (`vendor_count`), Negotiation Duration (`duration_seconds` humanized), approved by/at, and a per-item outcomes table. Button `Back to dashboard`. If RFQ not closed redirect to `/rfq/{id}`.
- [ ] **Step 4: Verify (full flow, browser):** run the 18-step demo from the spec end to end on RFQ-2026-041 (dashboard → RFQ → item → comparison → setup → negotiation → result → accept → approve → closed → dashboard). Confirm on the dashboard: Open RFQs −1, Completed Negotiations +1, Total savings +₹36,000 if final is ₹56,000 (numbers must equal what the result page showed). Screenshot the closed page and the updated dashboard. Note: the demo mutates the local SQLite; to re-run, delete `backend/data/aria_audit.db` (ask the user before deleting).
- [ ] **Step 5: Commit** `git commit -m "Add negotiation result, buyer approval and closed RFQ summary screens."`

---

### Task 14: Restyle legacy pages and redirects

**Files:** Modify `app/rfq/new/page.tsx`, `app/rfq/review/page.tsx`, `app/ops/layout.tsx`, `components/OpsShell.tsx`, `app/chat/page.tsx`. Move `app/rfq/new` and `app/rfq/review` into `app/(app)/rfq/new` and `app/(app)/rfq/review` (route group move keeps URLs) so they inherit `AppShell`.

- [ ] **Step 1:** Move the two RFQ pages into the `(app)` group (`git mv`). Replace bone/amber/stitch/ink classes with the new tokens (`bg-panel`, `border-line`, `text-txt`, `text-muted`, `text-brand`, `bg-brand text-white`, `text-danger`), swap `font-display` headings for `font-hanken font-bold`. Keep all logic and API calls untouched. "Add RFQ" success now redirects to `/rfq/{request_id}` (pipeline detail) instead of `/?added=`; if not approved that page shows the review banner from Task 10.
- [ ] **Step 2:** Move `app/ops` under `app/(app)/ops` and delete `components/OpsShell.tsx` header markup; keep `StatCard` export (used by ops pages) and restyle it with tokens. Ops sub-nav becomes a tab row inside the page using tokens. Update imports.
- [ ] **Step 3:** `app/chat/page.tsx` → server redirect: if `part` param present, resolve to `/rfqs`; simplest: `redirect('/rfqs')` from `next/navigation`. Remove `ChatWidget` imports only if now unused; leave the component file in place (used by nothing) — delete `ChatWidget`, `DealRail`, `InsightsPanel`, `PartDossier` **only if** `grep` shows no remaining importers and after confirming with the user.
- [ ] **Step 4: Verify:** `npx tsc --noEmit && npm run build`; visit `/rfq/new`, `/rfq/review?request=…`, `/ops`, `/ops/metrics` in light and dark; console clean.
- [ ] **Step 5: Commit** `git commit -m "Move RFQ intake, review and ops pages into the new shell and restyle them with the emerald theme."`

---

### Task 15: Final verification

- [ ] **Step 1:** `cd backend && python -m pytest -q` → all green (122 original + new).
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit && npm run build` → success.
- [ ] **Step 3:** Run the full 18-step demo in the browser preview a second time from a clean DB (with user's OK to reset `aria_audit.db`), light and dark, desktop and mobile widths for dashboard + workspace. Report anything failing with output, no claims without evidence.
- [ ] **Step 4:** Update `README` "Routes" section (if one exists) with the new route list. Commit `git commit -m "Document the new dashboard flow routes."`

---

## Self-review (spec coverage)

- Dashboard KPIs / table / charts → Tasks 2, 8, 9. RFQ detail with item table → Task 10. Quote comparison → Task 10. Opportunity + Start button (no auto-start) → Task 10. Setup fields + objectives → Task 11 (objective stored on `BuyerConfig`; the engine ignores it for now — note this to the user). Three-pane workspace → Task 12. Result + Continue/Accept → Task 13. Approval + Approve & Close → Tasks 5, 13. Closed summary + duration → Tasks 4, 13. Mock data 10–15 RFQs / 30–50 vendors / 100+ items with consistent maths → Tasks 3, 2 (tests assert). Dashboard reflects outcomes → Task 5 test + Task 13 step 4. Theme → Tasks 6, 7, 14. Reuse of Aria → Tasks 5, 11, 12.
- Known limitation to raise with the user: `objective` other than "Reduce price" is recorded but not yet driving different Aria strategy (price is the only lever the engine targets by default; lead time / payment terms are already in `BuyerConfig`).
- Types cross-check: `item_view.best.unit_price`, `outcome.total_savings`, `rfq_view.original_value/final_value/realized_savings/negotiated_items/duration_seconds` are the names used by Tasks 9–13; endpoint paths match Task 5.
