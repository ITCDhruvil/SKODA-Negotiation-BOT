# Phase 3: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js buyer workspace on top of the Phase 2 API: app shell, dashboard, events, event detail, the item page (points, vendor quotes, side-by-side comparison, history), vendors, history, comparison, reports and ops, in light and dark themes and on phone widths.

**Architecture:** Next.js 14 App Router with client components fetching the FastAPI backend (`NEXT_PUBLIC_API_URL`, default `http://localhost:8000`). Response types are generated from the backend's OpenAPI file so the two cannot drift. All money values come from the API; the UI only formats them. Direction wording (Savings/Uplift, Ceiling/Floor) lives in one file, `lib/labels.ts`. Charts are hand-rolled SVG (no chart library).

**Tech Stack:** Next.js 14.2.35, React 18.3.1, TypeScript 5 (strict), Tailwind CSS 3.4, openapi-typescript 7 (dev). Backend additions in Python 3.11 / FastAPI. No frontend test runner (per spec): verification is `tsc`, `next build` and a browser walk-through.

**Spec:** `docs/superpowers/specs/2026-09-29-main-negotiation-bot-design.md` (sections 2 and 8). Builds on Phase 1 and Phase 2 plans (done, 210 backend tests).

## Global Constraints

- Colours and fonts come only from the reference theme (`reference/dashboard-ui/AIS_App_Shell_theme.html`): the CSS variable tokens in `app/globals.css` (light, dark, and `prefers-color-scheme` fallback), font Hanken Grotesk, sidebar 252px, radii 6/10/16px. Components use Tailwind classes mapped to those variables; never hard-code hex colours in components (the two `text-[#07130f]` on-brand button labels are the documented exception).
- The frontend never computes money. It formats and displays values returned by the API. The only arithmetic allowed is layout maths (chart coordinates, percentages of bar widths).
- The words that differ between buy and sell live in `lib/labels.ts` (`deltaLabel`, `limitLabel`, `bestLabel`, `partyLabel`, `objectiveOptions`). Do not write `direction === "sell"` style branches elsewhere except to pick those helpers' arguments.
- Indian number format (`en-IN`, rupee sign, lakh and crore in compact form).
- The vendor walk-away (ceiling or floor) is the buyer's own number and is shown to the buyer only. No hidden vendor value exists in any API response (Phase 2 guarantee); do not add any.
- Buyer control: nothing starts a negotiation on its own. The "Start negotiation" button is disabled in this phase and says so; the demo action "Collect vendor responses" is clearly labelled as a demo stand-in for the supplier flow built in Phase 4.
- Accessibility basics: labelled inputs, `role="status"`/`role="alert"` for messages, visible focus, keyboard-operable controls, `aria-current` on navigation and steps, charts have `role="img"` and an `aria-label`.
- Layout must work at 375px wide with no horizontal page scroll (tables scroll inside their own wrapper) and at desktop widths. Every grid gets a shrinkable default column (rule in `globals.css`).
- Frontend commands run from `D:\main-negotiation-bot\frontend`; backend commands from `D:\main-negotiation-bot\backend` with `python -m pytest -q -p no:asyncio`.
- Commit messages: one short plain paragraph, no prefix, no bullets, no attribution lines. Never commit `node_modules`, `.next`, `*.db`, `__pycache__`.
- Port 3000 may already be in use on the developer machine. The API allows extra frontend origins through `NEGOTIATION_CORS_ORIGINS` (Task 2).

## File Structure

```
backend/
  app/schemas.py            (modify: ItemRow, HistoryRow)
  app/readmodel.py          (modify: item_rows, history_rows)
  app/api.py                (modify: /api/items, /api/history, cors_origins)
  app/main.py               (modify: NEGOTIATION_CORS_ORIGINS)
  scripts/export_openapi.py writes backend/openapi.json
  openapi.json              generated, committed
  tests/test_lists.py, tests/test_openapi_drift.py
frontend/
  package.json, tsconfig.json, next.config.mjs, postcss.config.js, tailwind.config.ts, .env.example, .gitignore
  lib/api-types.ts          generated from ../backend/openapi.json
  lib/api.ts, format.ts, labels.ts, hooks.ts, providers.tsx
  components/ui/            Icon, basics, DataTable, State, charts, Tabs
  components/shell/AppShell.tsx
  components/events/EventsTable.tsx
  components/item/          Stepper, PointsPanel, OpportunityPanel, ComparisonMatrix, HistoryTab
  app/                      layout, globals.css, page (dashboard), events, items/[id], vendors, history, comparison, reports, ops
  README.md
```

---

### Task 1: Backend list endpoints (items and history)

The Comparison page needs "every item that has quotes" and the History page needs the global deal log; Phase 2 only had per-item views.

**Files:**
- Modify: `backend/app/schemas.py` (append), `backend/app/readmodel.py` (append), `backend/app/api.py`
- Create: `backend/tests/test_lists.py`

**Interfaces:**
- Produces: `schemas.ItemRow` (an `ItemView` plus `event_title, direction, category, category_key, event_status`); `schemas.HistoryRow` (a `HistoryPoint` plus `vendor_name, direction, category_key, unit, value_delta`); `readmodel.item_rows(snap, *, event_id, has_bids, recommendation, direction, q) -> list[ItemRow]` sorted by potential delta descending then id; `readmodel.history_rows(snap, *, direction, category_key, q, negotiated, limit) -> list[HistoryRow]` newest first; routes `GET /api/items` (query `event_id, has_bids, recommendation, direction, q`) and `GET /api/history` (query `direction, category_key, q, negotiated, limit` with `1 <= limit <= 1000`, default 500).

- [ ] **Step 1: Write the failing tests**


**File:** `backend/tests/test_lists.py`

```python
import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.models import Dataset
from app.store import Repo


@pytest.fixture
def client(repo: Repo, seed_dataset: Dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_items_list_covers_every_item_and_carries_event_context(client, seed_dataset: Dataset):
    rows = client.get("/api/items").json()
    assert len(rows) == len(seed_dataset.items) == 189
    r = rows[0]
    assert {"event_title", "direction", "category", "category_key", "event_status"} <= set(r)
    deltas = [x["potential_delta"] or 0 for x in rows]
    assert deltas == sorted(deltas, reverse=True)


def test_items_list_filters(client, seed_dataset: Dataset):
    with_bids = {b.item_id for b in seed_dataset.bids}
    got = client.get("/api/items", params={"has_bids": "true"}).json()
    assert {r["id"] for r in got} == with_bids
    none = client.get("/api/items", params={"has_bids": "false"}).json()
    assert len(none) == len(seed_dataset.items) - len(with_bids)
    neg = client.get("/api/items", params={"recommendation": "negotiate"}).json()
    assert neg and all(r["recommendation"] == "negotiate" for r in neg)
    ev = client.get("/api/items", params={"event_id": "EVT-2026-041"}).json()
    assert len(ev) == 6 and all(r["event_id"] == "EVT-2026-041" for r in ev)
    sells = client.get("/api/items", params={"direction": "sell"}).json()
    assert sells and all(r["direction"] == "sell" for r in sells)
    hit = client.get("/api/items", params={"q": "lunch buffet"}).json()
    assert any(r["id"] == "EVT-2026-041-01" for r in hit)
    assert client.get("/api/items", params={"recommendation": "bogus"}).status_code == 422


def test_history_list(client, seed_dataset: Dataset):
    rows = client.get("/api/history").json()
    assert len(rows) == len(seed_dataset.history) == 305
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates, reverse=True)
    assert {"vendor_name", "direction", "category_key", "unit", "value_delta"} <= set(rows[0])


def test_history_filters_and_limit(client):
    sells = client.get("/api/history", params={"direction": "sell"}).json()
    assert sells and all(r["direction"] == "sell" for r in sells)
    neg = client.get("/api/history", params={"negotiated": "true"}).json()
    assert neg and all(r["negotiated"] and r["value_delta"] > 0 for r in neg)
    plain = client.get("/api/history", params={"negotiated": "false"}).json()
    assert all(r["value_delta"] is None for r in plain)
    hit = client.get("/api/history", params={"q": "aluminium turnings"}).json()
    assert len(hit) == 6
    assert len(client.get("/api/history", params={"limit": 10}).json()) == 10
    assert client.get("/api/history", params={"limit": 0}).status_code == 422
    assert client.get("/api/history", params={"limit": 5000}).status_code == 422


def test_list_responses_never_contain_a_reserve(client):
    for path in ("/api/items", "/api/history"):
        assert "reserve" not in client.get(path).text.lower()
```


- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_lists.py -q -p no:asyncio`
Expected: FAIL (404 for `/api/items` and `/api/history`).

- [ ] **Step 3: Implement**

Append to `backend/app/schemas.py` (end of file):

```python
class ItemRow(ItemView):
    """An item with just enough event context for cross-event lists."""

    event_title: str
    direction: Direction
    category: str
    category_key: str
    event_status: EventStatus


class HistoryRow(HistoryPoint):
    vendor_name: str
    direction: Direction
    category_key: str
    unit: Unit
    value_delta: Optional[float]
```

Append to `backend/app/readmodel.py` (end of file):

```python
def item_rows(snap: Snapshot, *, event_id: Optional[str] = None, has_bids: Optional[bool] = None,
              recommendation: Optional[str] = None, direction: Optional[str] = None,
              q: Optional[str] = None) -> list[sch.ItemRow]:
    ivs = {i.id: item_view(snap, i) for i in snap.items}
    status = {e.id: lifecycle.event_status(ivs[i.id].state for i in snap.items_by_event[e.id])
              for e in snap.events}
    needle = q.lower() if q else None
    rows = []
    for item in snap.items:
        e, iv = snap.event_by_id[item.event_id], ivs[item.id]
        if event_id and item.event_id != event_id:
            continue
        if has_bids is not None and (iv.bid_count > 0) != has_bids:
            continue
        if recommendation and iv.recommendation != recommendation:
            continue
        if direction and e.direction != direction:
            continue
        if needle and needle not in " ".join(
                [item.id, item.description, e.title, e.category]).lower():
            continue
        rows.append(sch.ItemRow(
            **iv.model_dump(), event_title=e.title, direction=e.direction, category=e.category,
            category_key=e.category_key, event_status=status[e.id]))
    return sorted(rows, key=lambda r: (-(r.potential_delta or 0.0), r.id))


def history_rows(snap: Snapshot, *, direction: Optional[str] = None,
                 category_key: Optional[str] = None, q: Optional[str] = None,
                 negotiated: Optional[bool] = None,
                 limit: Optional[int] = None) -> list[sch.HistoryRow]:
    needle = q.lower() if q else None
    out = []
    for h in sorted(snap.history, key=lambda h: (h.closed_date, h.id), reverse=True):
        if direction and h.direction != direction:
            continue
        if category_key and h.category_key != category_key:
            continue
        if negotiated is not None and h.negotiated != negotiated:
            continue
        if needle and needle not in h.description.lower():
            continue
        delta = (deal.realised_delta(h.direction, h.original_price, h.unit_price, h.qty)
                 if h.negotiated and h.original_price is not None else None)
        out.append(sch.HistoryRow(
            **_point(h).model_dump(), vendor_name=_vendor_name(snap, h.vendor_id),
            direction=h.direction, category_key=h.category_key, unit=h.unit, value_delta=delta))
    return out[:limit] if limit else out
```

In `backend/app/api.py`: add `Query` to the `from fastapi import ...` line, and insert these two routes immediately BEFORE the existing `@app.get("/api/items/{item_id}", ...)` route (so the fixed paths are registered first):

```python
    @app.get("/api/items", response_model=list[sch.ItemRow])
    def items(event_id: Optional[str] = None, has_bids: Optional[bool] = None,
              recommendation: Optional[sch.Recommendation] = None,
              direction: Optional[Direction] = None, q: Optional[str] = None):
        return readmodel.item_rows(snap(), event_id=event_id, has_bids=has_bids,
                                   recommendation=recommendation, direction=direction, q=q)

    @app.get("/api/history", response_model=list[sch.HistoryRow])
    def history(direction: Optional[Direction] = None, category_key: Optional[str] = None,
                q: Optional[str] = None, negotiated: Optional[bool] = None,
                limit: int = Query(500, ge=1, le=1000)):
        return readmodel.history_rows(snap(), direction=direction, category_key=category_key,
                                      q=q, negotiated=negotiated, limit=limit)
```

- [ ] **Step 4: Run to see pass**

Run: `python -m pytest -q -p no:asyncio`
Expected: everything passes (210 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/readmodel.py backend/app/api.py backend/tests/test_lists.py
git commit -m "Add item and history list endpoints for the comparison and history pages."
```

---

### Task 2: Configurable CORS origins and the OpenAPI export

**Files:**
- Modify: `backend/app/api.py`, `backend/app/main.py`, `backend/tests/test_lists.py` (append one test)
- Create: `backend/scripts/export_openapi.py`, `backend/tests/test_openapi_drift.py`, `backend/openapi.json` (generated)

**Interfaces:**
- Produces: `DEFAULT_ORIGINS`; `create_app(repo, seed_dataset, cors_origins: Optional[list[str]] = None)`; env `NEGOTIATION_CORS_ORIGINS` (comma separated, replaces the default origins); `backend/openapi.json` (source for the frontend type generator); a test that fails when it drifts from the app.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_lists.py`:

```python
def test_cors_origins_are_configurable(repo: Repo, seed_dataset: Dataset):
    app = create_app(repo, seed_dataset, cors_origins=["http://localhost:3100"])
    c = TestClient(app)
    ok = c.get("/api/health", headers={"Origin": "http://localhost:3100"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3100"
    other = c.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert "access-control-allow-origin" not in other.headers
```


**File:** `backend/tests/test_openapi_drift.py`

```python
import json
from pathlib import Path

from app.api import create_app
from app.models import Dataset
from app.store import Repo

OPENAPI = Path(__file__).resolve().parents[1] / "openapi.json"


def test_committed_openapi_matches_the_running_app(repo: Repo, seed_dataset: Dataset):
    """The frontend types are generated from openapi.json: regenerate both when the API changes.

    Run: python scripts/export_openapi.py  then, in frontend/, npm run gen:types
    """
    committed = json.loads(OPENAPI.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(create_app(repo, seed_dataset).openapi()))
```


- [ ] **Step 2: Run to see failure**

Run: `python -m pytest tests/test_lists.py tests/test_openapi_drift.py -q -p no:asyncio`
Expected: FAIL (`create_app() got an unexpected keyword argument 'cors_origins'`, and no `openapi.json`).

- [ ] **Step 3: Implement**

In `backend/app/api.py` replace the `create_app` signature line and the `CORSMiddleware` origins:

```python
DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def create_app(repo: Repo, seed_dataset: Dataset,
               cors_origins: Optional[list[str]] = None) -> FastAPI:
```

and change the middleware argument `allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"]` to `allow_origins=cors_origins or DEFAULT_ORIGINS`.


**File:** `backend/app/main.py`

```python
"""Uvicorn entry point: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from pathlib import Path

from app.api import create_app
from app.models import Dataset
from app.seed.build import OUTPUT_DIR
from app.store import Repo

_DB_DEFAULT = Path(__file__).resolve().parents[1] / "data" / "app.db"
_SEED_FILE = OUTPUT_DIR / "dataset.json"

_repo = Repo(os.environ.get("NEGOTIATION_DB", str(_DB_DEFAULT)))
_repo.seed_if_empty(_SEED_FILE)
# The frontend normally runs on port 3000; set NEGOTIATION_CORS_ORIGINS (comma separated) when it
# runs elsewhere, for example http://localhost:3100.
_origins = [o.strip() for o in os.environ.get("NEGOTIATION_CORS_ORIGINS", "").split(",") if o.strip()]
app = create_app(
    _repo,
    Dataset.model_validate_json(_SEED_FILE.read_text(encoding="utf-8")),
    cors_origins=_origins or None,
)
```



**File:** `backend/scripts/export_openapi.py`

```python
"""Write the API schema for the frontend type generator: python scripts/export_openapi.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import create_app  # noqa: E402
from app.models import Dataset  # noqa: E402
from app.seed.build import OUTPUT_DIR  # noqa: E402
from app.store import Repo  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "openapi.json"

if __name__ == "__main__":
    ds = Dataset.model_validate_json((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
    repo = Repo()
    repo.load_dataset(ds)
    OUT.write_text(json.dumps(create_app(repo, ds).openapi(), indent=1), encoding="utf-8",
                   newline="\n")
    print(f"wrote {OUT}")
```


Then generate the schema file and run the suite:

```bash
python scripts/export_openapi.py
python -m pytest -q -p no:asyncio
```
Expected: `wrote ...\backend\openapi.json`, then all tests pass (217 in total with Task 1).

- [ ] **Step 4: Commit**

```bash
git add backend/app/api.py backend/app/main.py backend/scripts/export_openapi.py backend/openapi.json backend/tests/test_lists.py backend/tests/test_openapi_drift.py
git commit -m "Make the allowed frontend origins configurable and export the OpenAPI schema with a drift test."
```

---

### Task 3: Frontend foundation (config, theme, typed API client)

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/next.config.mjs`, `frontend/postcss.config.js`, `frontend/tailwind.config.ts`, `frontend/.env.example`, `frontend/.gitignore`, `frontend/app/globals.css`, `frontend/lib/api.ts`, `frontend/lib/format.ts`, `frontend/lib/labels.ts`, `frontend/lib/hooks.ts`, `frontend/lib/providers.tsx`
- Generate: `frontend/lib/api-types.ts`, `frontend/package-lock.json`

**Interfaces:**
- Produces: `api` (typed client, one function per backend route), `ApiError`, `API_BASE`, type aliases (`Dashboard, EventView, EventDetail, ItemView, ItemRow, ItemDetail, ComparisonView, HistoryView, HistoryRow, VendorView, VendorDetail, Direction, ItemState, Recommendation, Objective, DateRange`); `useApi(fetcher, deps) -> {data, error, loading, reload}`; `Providers`, `useTheme()`, `useRange()`; formatters `num, money, moneyCompact, pct, dateShort, initials`; labels and tones (`deltaLabel, limitLabel, bestLabel, partyLabel, directionText, STATE_LABEL/TONE, STATUS_LABEL/TONE, RECOMMENDATION_LABEL/TONE, objectiveOptions, STEPS`, `type Tone`).

- [ ] **Step 1: Create the files below exactly**


**File:** `frontend/package.json`

```json
{
  "name": "negotiation-frontend",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit",
    "gen:types": "openapi-typescript ../backend/openapi.json -o lib/api-types.ts"
  },
  "dependencies": {
    "next": "14.2.35",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "openapi-typescript": "^7.4.4",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "typescript": "^5.6.3"
  }
}
```

**File:** `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**File:** `frontend/next.config.mjs`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No ESLint in this POC: types are checked with `npm run typecheck`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
```

**File:** `frontend/postcss.config.js`

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**File:** `frontend/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

// Every colour is a CSS variable so light and dark themes switch without class changes.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), panel: v("panel"), raise: v("raise"), line: v("line"), line2: v("line2"),
        ink: v("ink"), text: v("text"), muted: v("muted"),
        brand: v("brand"), "brand-soft": v("brand-soft"),
        ok: v("ok"), "ok-soft": v("ok-soft"),
        amber: v("amber"), "amber-soft": v("amber-soft"),
        red: v("red"), "red-soft": v("red-soft"),
        info: v("info"), "info-soft": v("info-soft"),
        emerald: v("emerald"), emerald2: v("emerald2"),
        "side-t": v("side-t"), "side-m": v("side-m"),
        electric: v("electric"), "e-ink": v("e-ink"),
        focus: v("focus"),
      },
      borderRadius: { s: "6px", m: "10px", l: "16px" },
      fontFamily: {
        sans: ['"Hanken Grotesk"', "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(8,32,25,.06)", pop: "0 24px 60px -18px rgba(8,32,25,.35)" },
    },
  },
  plugins: [],
};

export default config;
```

**File:** `frontend/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Tokens copied from reference/dashboard-ui/AIS_App_Shell_theme.html (light + dark). */
:root {
  --bg: #f0f3f1; --panel: #ffffff; --raise: #f6f8f7; --line: #dae1dd; --line2: #e8edea;
  --ink: #0f2c24; --text: #1a2a25; --muted: #5a6b65;
  --brand: #0a6a4e; --brand-soft: #e1efe7;
  --emerald: #0e3a2f; --emerald2: #154a3c; --side-t: #cfe3da; --side-m: #8db2a4;
  --electric: #78faae; --e-ink: #06331d;
  --amber: #955a00; --amber-soft: #fbefd6; --red: #b42318; --red-soft: #fce8e6;
  --ok: #1b7443; --ok-soft: #e0f2e6; --info: #3047a6; --info-soft: #e6eafa; --focus: #1f63d1;
}

:root[data-theme="dark"] {
  --bg: #0b1411; --panel: #121d19; --raise: #16231e; --line: #24342e; --line2: #1c2a25;
  --ink: #e3eee9; --text: #dae5e0; --muted: #92a59d; --brand: #6ad7a2; --brand-soft: #16302a;
  --emerald: #08201a; --emerald2: #0f2d24; --amber: #e6ae52; --amber-soft: #33281a;
  --red: #f08a80; --red-soft: #3a201d; --ok: #6dcb93; --ok-soft: #173024;
  --info: #9db0ff; --info-soft: #1d2440;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0b1411; --panel: #121d19; --raise: #16231e; --line: #24342e; --line2: #1c2a25;
    --ink: #e3eee9; --text: #dae5e0; --muted: #92a59d; --brand: #6ad7a2; --brand-soft: #16302a;
    --emerald: #08201a; --emerald2: #0f2d24; --amber: #e6ae52; --amber-soft: #33281a;
    --red: #f08a80; --red-soft: #3a201d; --ok: #6dcb93; --ok-soft: #173024;
    --info: #9db0ff; --info-soft: #1d2440;
  }
}


/* Grid tracks must be allowed to shrink, or wide children (tables) stretch the page on phones.
   Breakpoint utilities such as sm:grid-cols-2 still override this. */
@layer base {
  .grid { grid-template-columns: minmax(0, 1fr); }
}

html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "tnum" 1;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

**File:** `frontend/.env.example`

```
# Where the FastAPI backend runs
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**File:** `frontend/.gitignore`

```
node_modules
.next
next-env.d.ts
*.tsbuildinfo
.env.local
```

**File:** `frontend/lib/api.ts`

```ts
import type { components } from "./api-types";

type S = components["schemas"];

export type Dashboard = S["Dashboard"];
export type EventView = S["EventView"];
export type EventDetail = S["EventDetail"];
export type ItemView = S["ItemView"];
export type ItemRow = S["ItemRow"];
export type ItemDetail = S["ItemDetail"];
export type ComparisonView = S["ComparisonView"];
export type ComparisonRow = S["ComparisonRow"];
export type HistoryView = S["HistoryView"];
export type HistoryRow = S["HistoryRow"];
export type HistoryPoint = S["HistoryPoint"];
export type OutcomeView = S["OutcomeView"];
export type Invitee = S["Invitee"];
export type VendorView = S["VendorView"];
export type VendorDetail = S["VendorDetail"];
export type Kpis = S["Kpis"];

export type Direction = EventView["direction"];
export type EventStatus = EventView["status"];
export type ItemState = ItemView["state"];
export type Recommendation = ItemView["recommendation"];
export type Objective = NonNullable<S["PointsIn"]["objective"]>;

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return loc ? `${loc}: ${d?.msg ?? "invalid"}` : String(d?.msg ?? "invalid");
      })
      .join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* keep status text */
    }
    throw new ApiError(res.status, describe(detail, res.statusText));
  }
  return (await res.json()) as T;
}

type Params = Record<string, string | number | boolean | null | undefined>;

function qs(params: Params): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export type DateRange = { from: string; to: string };

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<S["Health"]>("/api/health"),
  dashboard: (r: DateRange) =>
    request<Dashboard>(`/api/dashboard${qs({ date_from: r.from, date_to: r.to })}`),
  events: (p: { q?: string; direction?: string; status?: string; category_key?: string } & Partial<DateRange>) =>
    request<EventView[]>(
      `/api/events${qs({ q: p.q, direction: p.direction, status: p.status, category_key: p.category_key, date_from: p.from, date_to: p.to })}`,
    ),
  event: (id: string) => request<EventDetail>(`/api/events/${id}`),
  simulate: (direction: Direction) => post<EventDetail>("/api/events/simulate", { direction }),
  items: (p: { event_id?: string; has_bids?: boolean; recommendation?: string; direction?: string; q?: string }) =>
    request<ItemRow[]>(`/api/items${qs(p)}`),
  item: (id: string) => request<ItemDetail>(`/api/items/${id}`),
  itemHistory: (id: string) => request<HistoryView>(`/api/items/${id}/history`),
  setPoints: (id: string, body: { target: number; limit: number; objective?: Objective | null }) =>
    request<ItemDetail>(`/api/items/${id}/points`, { method: "PUT", body: JSON.stringify(body) }),
  confirmPoints: (id: string) => post<ItemDetail>(`/api/items/${id}/confirm-points`),
  releaseBids: (id: string, vendorIds?: string[]) =>
    post<ItemDetail>(`/api/items/${id}/release-bids`, { vendor_ids: vendorIds ?? null }),
  analyze: (id: string) => post<ItemDetail>(`/api/items/${id}/analyze`),
  vendors: () => request<VendorView[]>("/api/vendors"),
  vendor: (id: string) => request<VendorDetail>(`/api/vendors/${id}`),
  history: (p: { direction?: string; category_key?: string; q?: string; negotiated?: boolean; limit?: number }) =>
    request<HistoryRow[]>(`/api/history${qs(p)}`),
  reset: () => post<S["ResetResult"]>("/api/admin/reset"),
};
```

**File:** `frontend/lib/format.ts`

```ts
// Display formatting only. The frontend never computes money: it renders values from the API.

const IN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const num = (v: number | null | undefined): string => (v == null ? "—" : IN.format(v));

export const money = (v: number | null | undefined): string => (v == null ? "—" : `₹ ${IN.format(v)}`);

/** Indian compact units: lakh (L) and crore (Cr). */
export function moneyCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹ ${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹ ${(v / 1e5).toFixed(2)} L`;
  return money(v);
}

export const pct = (v: number | null | undefined, digits = 1): string =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
```

**File:** `frontend/lib/labels.ts`

```ts
import type { Direction, EventStatus, ItemState, Objective, Recommendation } from "./api";

export type Tone = "muted" | "ok" | "amber" | "red" | "info" | "brand";

// The single place where the UI names the buy/sell difference. Numbers come from the API.
export const deltaLabel = (d: Direction): string => (d === "buy" ? "Savings" : "Uplift");
export const limitLabel = (d: Direction): string => (d === "buy" ? "Ceiling" : "Floor");
export const bestLabel = (d: Direction): string => (d === "buy" ? "Lowest" : "Highest");
export const partyLabel = (d: Direction): string => (d === "buy" ? "Supplier" : "Scrap buyer");
export const directionText = (d: Direction): string => (d === "buy" ? "BUY" : "SELL");

export const STATE_LABEL: Record<ItemState, string> = {
  draft: "Draft",
  points_reviewed: "Points confirmed",
  awaiting_bids: "Awaiting quotes",
  bids_in: "Quotes in",
  analyzed: "Analyzed",
  negotiating: "Negotiating",
  result_pending: "Result pending",
  awaiting_approval: "Awaiting approval",
  closed: "Closed",
  handed_back: "Handed back",
};

export const STATE_TONE: Record<ItemState, Tone> = {
  draft: "muted",
  points_reviewed: "info",
  awaiting_bids: "amber",
  bids_in: "info",
  analyzed: "brand",
  negotiating: "amber",
  result_pending: "amber",
  awaiting_approval: "info",
  closed: "ok",
  handed_back: "red",
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  closed: "Closed",
};

export const STATUS_TONE: Record<EventStatus, Tone> = {
  received: "info",
  in_progress: "amber",
  closed: "ok",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  waiting: "Waiting for quotes",
  negotiate: "Negotiation recommended",
  accept: "Best quote acceptable",
  review: "Buyer review needed",
  done: "Done",
};

export const RECOMMENDATION_TONE: Record<Recommendation, Tone> = {
  waiting: "muted",
  negotiate: "amber",
  accept: "ok",
  review: "red",
  done: "ok",
};

/** Objective choices for the points form; wording follows the event direction. */
export function objectiveOptions(d: Direction): { value: Objective; label: string }[] {
  return [
    { value: "reduce_price", label: d === "buy" ? "Reduce price" : "Raise price" },
    { value: "improve_lead_time", label: d === "buy" ? "Improve lead time" : "Improve pickup schedule" },
    { value: "improve_payment_terms", label: "Improve payment terms" },
    { value: "improve_commercial_terms", label: "Improve commercial terms" },
  ];
}

/** Lifecycle steps shown on the item page, in order. */
export const STEPS: { key: string; label: string; states: ItemState[] }[] = [
  { key: "points", label: "Points", states: ["draft", "points_reviewed"] },
  { key: "quotes", label: "Quotes", states: ["awaiting_bids", "bids_in"] },
  { key: "analysis", label: "Analysis", states: ["analyzed"] },
  { key: "negotiation", label: "Negotiation", states: ["negotiating", "result_pending", "handed_back"] },
  { key: "approval", label: "Approval", states: ["awaiting_approval"] },
  { key: "closed", label: "Closed", states: ["closed"] },
];
```

**File:** `frontend/lib/hooks.ts`

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/** Fetch on mount and whenever `deps` change. Stale responses are ignored. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (id === seq.current) {
        setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
```

**File:** `frontend/lib/providers.tsx`

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DateRange } from "./api";

type Theme = "light" | "dark";

type ThemeCtx = { theme: Theme; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

type RangeCtx = { range: DateRange; setRange: (r: DateRange) => void };
const RangeContext = createContext<RangeCtx>({ range: { from: "", to: "" }, setRange: () => {} });
export const useRange = () => useContext(RangeContext);

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked; the app still works */
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [range, setRangeState] = useState<DateRange>({ from: "", to: "" });

  useEffect(() => {
    const stored = safeGet("theme");
    const initial: Theme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initial);
    try {
      const saved = JSON.parse(safeGet("range") ?? "null");
      if (saved && typeof saved.from === "string" && typeof saved.to === "string") setRangeState(saved);
    } catch {
      /* ignore a corrupt value */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      safeSet("theme", next);
      return next;
    });
  }, []);

  const setRange = useCallback((r: DateRange) => {
    setRangeState(r);
    safeSet("range", JSON.stringify(r));
  }, []);

  const themeValue = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  const rangeValue = useMemo(() => ({ range, setRange }), [range, setRange]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <RangeContext.Provider value={rangeValue}>{children}</RangeContext.Provider>
    </ThemeContext.Provider>
  );
}
```


- [ ] **Step 2: Install and generate the API types**

```bash
cd frontend
npm install
npm run gen:types
npx tsc --noEmit
```
Expected: dependencies install, `lib/api-types.ts` is written from `../backend/openapi.json`, and `tsc` prints nothing (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/next.config.mjs frontend/postcss.config.js frontend/tailwind.config.ts frontend/.env.example frontend/.gitignore frontend/app/globals.css frontend/lib
git commit -m "Add the frontend foundation: Next.js and Tailwind setup with the reference theme, a typed API client generated from the OpenAPI schema, and formatting and label helpers."
```

---

### Task 4: UI kit (primitives, table, charts)

**Files:**
- Create: `frontend/components/ui/Icon.tsx`, `basics.tsx`, `DataTable.tsx`, `State.tsx`, `charts.tsx`, `Tabs.tsx`

**Interfaces:**
- Produces: `Icon`, `IconName`; `Pill, DirectionBadge, Money, Delta, Button, ButtonLink, Panel, KpiCard, Field, inputClass` (basics); `DataTable<T>` and `Column<T>` (with `hideOnMobile`); `Loading, ErrorBox, Notice, PageHeader` (State); `Donut` (with optional fixed `total`), `Legend, StackBar, Avatar, TrendChart, SERIES` (charts); `Tabs<K>`.

- [ ] **Step 1: Create the files below exactly**


**File:** `frontend/components/ui/Icon.tsx`

```tsx
import type { SVGProps } from "react";

const PATHS = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  events: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  vendors: "M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-2a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  comparison: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  reports: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h4",
  ops: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M6 6l12 12M18 6L6 18",
  calendar: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  plus: "M12 5v14M5 12h14",
  chevron: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  bulb: "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z",
  bag: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  cube: "M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.5L12 12.5l8.7-5M12 22V12.5",
  coin: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9 9.5h5a2 2 0 0 1 0 4H9M9 9.5v6M13 13.5l2.5 3",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  check: "M5 12l5 5L20 7",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
```

**File:** `frontend/components/ui/basics.tsx`

```tsx
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Direction } from "@/lib/api";
import { deltaLabel, directionText, type Tone } from "@/lib/labels";
import { money } from "@/lib/format";
import { Icon, type IconName } from "./Icon";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-raise text-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  amber: "bg-amber-soft text-amber border-transparent",
  red: "bg-red-soft text-red border-transparent",
  info: "bg-info-soft text-info border-transparent",
  brand: "bg-brand-soft text-brand border-transparent",
};

export function Pill({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  return <Pill tone={direction === "buy" ? "info" : "amber"}>{directionText(direction)}</Pill>;
}

export function Money({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{money(value)}</span>;
}

/** A savings/uplift amount: same field for both directions, labelled by direction. */
export function Delta({
  value,
  direction,
  label = false,
}: {
  value: number | null | undefined;
  direction: Direction;
  label?: boolean;
}) {
  if (value == null) return <span className="text-muted">—</span>;
  const good = value > 0;
  return (
    <span className={`tabular-nums font-semibold ${good ? "text-ok" : "text-muted"}`}>
      {money(value)}
      {label && <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(direction)}</span>}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANT = {
  primary: "bg-brand text-white hover:opacity-90 dark:text-[#07130f] border-transparent",
  secondary: "bg-panel text-ink border-line hover:border-brand",
  ghost: "bg-transparent text-text border-transparent hover:bg-raise",
  danger: "bg-red-soft text-red border-transparent hover:opacity-90",
} as const;

export function Button({ variant = "secondary", size = "md", className = "", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-m border font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${BUTTON_VARIANT[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "sm",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-m border font-semibold transition ${
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      } ${BUTTON_VARIANT[variant ?? "secondary"]}`}
    >
      {children}
    </Link>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-l border border-line bg-panel shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "pt-3" : "p-5"}>{children}</div>
    </section>
  );
}

const KPI_ICON_TONE: Record<Tone, string> = {
  muted: "bg-raise text-muted",
  ok: "bg-ok-soft text-ok",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
};

export function KpiCard({
  icon,
  tone = "brand",
  label,
  value,
  sub,
}: {
  icon: IconName;
  tone?: Tone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-l border border-line bg-panel p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-m ${KPI_ICON_TONE[tone]}`}>
          <Icon name={icon} size={20} />
        </span>
        <span className="text-sm font-medium text-muted">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-extrabold tracking-tight text-ink tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-m border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";
```

**File:** `frontend/components/ui/DataTable.tsx`

```tsx
import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide this column below the `md` breakpoint. */
  hideOnMobile?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = "Nothing to show.",
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
}) {
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const pad = dense ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line2 bg-raise text-xs font-semibold text-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${pad} ${align(c.align)} whitespace-nowrap ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line2 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-raise" : ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${pad} ${align(c.align)} align-middle ${c.hideOnMobile ? "hidden md:table-cell" : ""} ${c.className ?? ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**File:** `frontend/components/ui/State.tsx`

```tsx
import type { ReactNode } from "react";
import { Button } from "./basics";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-3 p-2">
      <span className="sr-only">{label}</span>
      {[70, 100, 85].map((w, i) => (
        <div key={i} className="h-4 animate-pulse rounded-s bg-raise" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-m border border-transparent bg-red-soft p-4 text-sm text-red">
      <p className="font-semibold">Could not load data</p>
      <p className="mt-1 break-words">{message}</p>
      <p className="mt-1 text-xs opacity-80">Is the API running? Start it with: python -m uvicorn app.main:app --port 8000</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "amber" | "red" | "ok"; children: ReactNode }) {
  const cls = {
    info: "bg-info-soft text-info",
    amber: "bg-amber-soft text-amber",
    red: "bg-red-soft text-red",
    ok: "bg-ok-soft text-ok",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`rounded-m px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && <div className="mb-1 text-xs text-muted">{crumbs}</div>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
```

**File:** `frontend/components/ui/charts.tsx`

```tsx
import type { ReactNode } from "react";
import { initials, num } from "@/lib/format";

export const SERIES = [
  "var(--brand)",
  "var(--info)",
  "var(--amber)",
  "var(--red)",
  "var(--ok)",
  "var(--muted)",
];

export type Segment = { label: string; value: number; color: string };

export function Donut({
  segments,
  centerTop,
  centerBottom,
  label,
  total: fixedTotal,
}: {
  segments: Segment[];
  centerTop: string;
  centerBottom: string;
  label: string;
  /** Use when segment values are already shares of a known whole (e.g. 1); the rest stays as track. */
  total?: number;
}) {
  const total = fixedTotal ?? segments.reduce((s, x) => s + x.value, 0);
  const r = 48;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className="mx-auto h-40 w-40">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line2)" strokeWidth="16" />
      {total > 0 &&
        segments.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(len - 1, 0)} ${c - Math.max(len - 1, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="60" y="58" textAnchor="middle" className="fill-ink" style={{ fontSize: 13, fontWeight: 800 }}>
        {centerTop}
      </text>
      <text x="60" y="72" textAnchor="middle" className="fill-muted" style={{ fontSize: 8 }}>
        {centerBottom}
      </text>
    </svg>
  );
}

export function Legend({ rows }: { rows: { color: string; label: ReactNode; right: ReactNode }[] }) {
  return (
    <ul className="grid gap-2 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="min-w-0 flex-1 truncate text-text">{r.label}</span>
          <span className="shrink-0 text-muted tabular-nums">{r.right}</span>
        </li>
      ))}
    </ul>
  );
}

export function StackBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div role="img" aria-label={label} className="flex h-3 overflow-hidden rounded-full bg-raise">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
            ))}
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 text-text">{s.label}</span>
            <span className="font-semibold text-ink tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white dark:text-[#07130f]"
      style={{ background: SERIES[index % SERIES.length] }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export type TrendPoint = { date: string; price: number; negotiated: boolean };
export type RefLine = { value: number; label: string; color: string };

/** Price over time. Filled dots are negotiated deals; reference lines mark today's anchors. */
export function TrendChart({ points, refLines = [], label }: { points: TrendPoint[]; refLines?: RefLine[]; label: string }) {
  const W = 640;
  const H = 240;
  const m = { l: 56, r: 16, t: 16, b: 32 };
  if (points.length === 0) return <p className="text-sm text-muted">No history to chart.</p>;
  const times = points.map((p) => new Date(`${p.date}T00:00:00`).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = [...points.map((p) => p.price), ...refLines.map((r) => r.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || hi * 0.05 || 1) * 0.12;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (t: number) => m.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const ordered = points.map((p, i) => ({ ...p, t: times[i] })).sort((a, b) => a.t - b.t);
  const path = ordered.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const ticks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line2)" />
          <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
            {num(Math.round(t * 100) / 100)}
          </text>
        </g>
      ))}
      {refLines.map((r) => (
        <g key={r.label}>
          <line x1={m.l} x2={W - m.r} y1={y(r.value)} y2={y(r.value)} stroke={r.color} strokeDasharray="5 4" strokeWidth={1.5} />
          <text x={W - m.r} y={y(r.value) - 4} textAnchor="end" style={{ fontSize: 11, fill: r.color, fontWeight: 600 }}>
            {r.label}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth={1.5} />
      {ordered.map((p) => (
        <circle
          key={`${p.date}-${p.price}`}
          cx={x(p.t)}
          cy={y(p.price)}
          r={4.5}
          fill={p.negotiated ? "var(--brand)" : "var(--panel)"}
          stroke="var(--brand)"
          strokeWidth={2}
        >
          <title>{`${p.date}: ${num(p.price)}${p.negotiated ? " (negotiated)" : ""}`}</title>
        </circle>
      ))}
      <text x={m.l} y={H - 8} className="fill-muted" style={{ fontSize: 11 }}>
        {ordered[0].date}
      </text>
      <text x={W - m.r} y={H - 8} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
        {ordered[ordered.length - 1].date}
      </text>
    </svg>
  );
}
```

**File:** `frontend/components/ui/Tabs.tsx`

```tsx
"use client";

import type { ReactNode } from "react";

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```


- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui
git commit -m "Add the UI kit: buttons, pills, panels, KPI cards, data table, states and hand-rolled SVG charts."
```

---

### Task 5: App shell, dashboard and events pages

**Files:**
- Create: `frontend/components/shell/AppShell.tsx`, `frontend/components/events/EventsTable.tsx`, `frontend/app/layout.tsx`, `frontend/app/page.tsx`, `frontend/app/events/page.tsx`, `frontend/app/events/[id]/page.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: the app frame (emerald sidebar 252px with Dashboard, Events, Vendors, Comparison, History, Reports, Ops; topbar with search, date-range menu, theme toggle, avatar; phone drawer), `EventsTable`, the dashboard, the events list (filters `q`, type, status, date range) and the event detail page (metadata, KPIs, items table, closed summary).

- [ ] **Step 1: Create the files below exactly**


**File:** `frontend/components/shell/AppShell.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { dateShort, initials } from "@/lib/format";
import { useRange, useTheme } from "@/lib/providers";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/vendors", label: "Vendors", icon: "vendors" },
  { href: "/comparison", label: "Comparison", icon: "comparison" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/ops", label: "Ops", icon: "ops" },
];

const USER = { name: "Dhruvil Patel", role: "Buyer · SAVWIPL Pune" };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/events") return pathname.startsWith("/events") || pathname.startsWith("/items");
  return pathname.startsWith(href);
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col bg-emerald px-3 pb-3 pt-[18px] text-side-t">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-electric text-[13px] font-extrabold text-e-ink">
          NB
        </span>
        <div>
          <b className="block text-base text-white">Negotiation Bot</b>
          <span className="block text-[11.5px] text-side-m">SKODA Auto VW India · POC</span>
        </div>
      </div>
      <nav aria-label="Main" className="grid gap-0.5">
        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 font-medium transition ${
                active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
              }`}
            >
              {active && <span className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-r bg-electric" />}
              <Icon name={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-white/10 px-1 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/10 text-xs font-bold text-white">
            {initials(USER.name)}
          </span>
          <div className="min-w-0">
            <b className="block truncate text-[13px] text-white">{USER.name}</b>
            <span className="text-[11.5px] text-side-m">{USER.role}</span>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-side-m">
          Smarter negotiations. Better outcomes. Prices and scrap rates are illustrative POC values.
        </p>
      </div>
    </div>
  );
}

function DateRangeMenu() {
  const { range, setRange } = useRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
  }, [range.from, range.to]);
  const label =
    range.from || range.to
      ? `${range.from ? dateShort(range.from) : "…"} – ${range.to ? dateShort(range.to) : "…"}`
      : "All dates";
  const invalid = Boolean(from && to && from > to);
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 text-sm font-medium text-ink hover:border-brand">
        <Icon name="calendar" size={16} />
        <span className="hidden sm:inline">{label}</span>
        <Icon name="down" size={14} />
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 rounded-l border border-line bg-panel p-4 shadow-pop">
        <p className="mb-3 text-xs text-muted">Filter events by the date they were created.</p>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-ink">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-m border border-line bg-panel px-2 py-1.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-m border border-line bg-panel px-2 py-1.5 text-sm" />
          </label>
          {invalid && <p className="text-xs text-red">“From” must not be after “To”.</p>}
          <div className="flex justify-end gap-2">
            <button
              className="rounded-m px-3 py-1.5 text-xs font-semibold text-muted hover:bg-raise"
              onClick={(e) => {
                setRange({ from: "", to: "" });
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              }}
            >
              Clear
            </button>
            <button
              disabled={invalid}
              className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:text-[#07130f]"
              onClick={(e) => {
                setRange({ from, to });
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : "/events");
  };
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line2 bg-bg/90 px-4 py-2.5 backdrop-blur md:px-6">
      <button
        className="grid h-10 w-10 place-items-center rounded-m text-ink hover:bg-raise lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>
      <form onSubmit={submit} role="search" className="flex min-w-0 max-w-xl flex-1 items-center gap-2 rounded-m border border-line bg-panel px-3 py-2 hover:border-brand">
        <Icon name="search" size={16} className="text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search event, item, category…"
          aria-label="Search events"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <DateRangeMenu />
        <button
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="grid h-10 w-10 place-items-center rounded-m border border-transparent text-ink hover:bg-raise"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <span className="hidden h-9 w-9 place-items-center rounded-full bg-emerald text-xs font-bold text-white sm:grid" title={USER.name}>
          {initials(USER.name)}
        </span>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Sidebar pathname={pathname} onNavigate={() => {}} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div className="absolute inset-y-0 left-0 w-[268px]">
            <Sidebar pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
```

**File:** `frontend/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Negotiation Bot",
  description: "Buyer workspace for BUY and SELL negotiation events (POC)",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Sets the saved theme before first paint so the page does not flash the wrong colours.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
```

**File:** `frontend/components/events/EventsTable.tsx`

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventView } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { STATUS_LABEL, STATUS_TONE, deltaLabel } from "@/lib/labels";
import { DirectionBadge, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";

export function EventsTable({ events, empty }: { events: EventView[]; empty?: string }) {
  const router = useRouter();
  const columns: Column<EventView>[] = [
    {
      key: "id",
      header: "Event #",
      cell: (e) => (
        <Link href={`/events/${e.id}`} className="font-semibold text-brand hover:underline" onClick={(ev) => ev.stopPropagation()}>
          {e.id}
        </Link>
      ),
    },
    {
      key: "title",
      header: "Title",
      cell: (e) => (
        <div className="max-w-[260px]">
          <div className="truncate font-semibold text-ink" title={e.title}>
            {e.title}
          </div>
          <div className="text-xs text-muted">{dateShort(e.created)}</div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideOnMobile: true,
      cell: (e) => (
        <span className="block max-w-[180px] truncate text-muted" title={e.category}>
          {e.category}
        </span>
      ),
    },
    { key: "type", header: "Type", cell: (e) => <DirectionBadge direction={e.direction} /> },
    { key: "items", header: "Items", align: "right", hideOnMobile: true, cell: (e) => e.item_count },
    { key: "vendors", header: "Vendors", align: "right", hideOnMobile: true, cell: (e) => e.vendor_count },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (e) => <span className="tabular-nums">{money(e.status === "closed" ? (e.final_value ?? e.quoted_value) : e.quoted_value)}</span>,
    },
    {
      key: "delta",
      header: "Potential",
      align: "right",
      hideOnMobile: true,
      cell: (e) =>
        e.status === "closed" ? (
          <span className="tabular-nums font-semibold text-ok">
            {money(e.realised_delta)}
            <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(e.direction)} achieved</span>
          </span>
        ) : e.potential_delta > 0 ? (
          <span className="tabular-nums font-semibold text-ok">{money(e.potential_delta)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (e) => (
        <div className="grid gap-1">
          <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
          {!e.eligibility.eligible && (
            <span title={e.eligibility.reason}>
              <Pill tone="red">Not eligible</Pill>
            </span>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      cell: (e) => (
        <Link
          href={`/events/${e.id}`}
          onClick={(ev) => ev.stopPropagation()}
          className="inline-flex rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand"
        >
          View
        </Link>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={events}
      rowKey={(e) => e.id}
      onRowClick={(e) => router.push(`/events/${e.id}`)}
      empty={empty ?? "No events match."}
    />
  );
}
```

**File:** `frontend/app/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventsTable } from "@/components/events/EventsTable";
import { Delta, DirectionBadge, KpiCard, Panel } from "@/components/ui/basics";
import { Avatar, Donut, Legend, SERIES, StackBar } from "@/components/ui/charts";
import { Icon } from "@/components/ui/Icon";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type Dashboard, type Direction } from "@/lib/api";
import { moneyCompact, money, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

type Filter = "all" | "buy" | "sell" | "open" | "closed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "buy", label: "Buy" },
  { key: "sell", label: "Sell" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { range } = useRange();
  const { data, error, loading, reload } = useApi(() => api.dashboard(range), [range.from, range.to]);
  const [hello, setHello] = useState("Welcome");
  const [filter, setFilter] = useState<Filter>("all");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setHello(greeting()), []);

  const simulate = async (direction: Direction, menu: HTMLDetailsElement | null) => {
    menu?.removeAttribute("open");
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.simulate(direction);
      setCreated(res.event.id);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${hello}, Dhruvil`}
        subtitle="Here is an overview of your sourcing events and negotiation progress."
        actions={
          <details className="relative">
            <summary
              className={`inline-flex cursor-pointer list-none items-center gap-2 rounded-m bg-brand px-4 py-2 text-sm font-semibold text-white dark:text-[#07130f] ${busy ? "opacity-60" : ""}`}
            >
              <Icon name="plus" size={16} /> Simulate event
            </summary>
            <div className="absolute right-0 z-30 mt-2 grid w-56 gap-1 rounded-l border border-line bg-panel p-2 shadow-pop">
              <button
                className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise"
                onClick={(e) => simulate("buy", e.currentTarget.closest("details"))}
              >
                New BUY cart
                <span className="block text-xs font-normal text-muted">Services or goods from suppliers</span>
              </button>
              <button
                className="rounded-m px-3 py-2 text-left text-sm font-medium text-ink hover:bg-raise"
                onClick={(e) => simulate("sell", e.currentTarget.closest("details"))}
              >
                New SELL scrap lot
                <span className="block text-xs font-normal text-muted">Scrap for bidding buyers</span>
              </button>
            </div>
          </details>
        }
      />

      {created && (
        <div className="mb-4">
          <Notice tone="ok">
            Created <Link href={`/events/${created}`} className="font-semibold underline">{created}</Link> as a new draft event.
          </Notice>
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <Notice tone="red">{actionError}</Notice>
        </div>
      )}

      {loading && !data && <Loading label="Loading dashboard" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && <DashboardBody data={data} filter={filter} setFilter={setFilter} />}
    </>
  );
}

function DashboardBody({ data, filter, setFilter }: { data: Dashboard; filter: Filter; setFilter: (f: Filter) => void }) {
  const k = data.kpis;
  const events = data.events.filter((e) =>
    filter === "all" ? true : filter === "buy" || filter === "sell" ? e.direction === filter : filter === "open" ? e.status !== "closed" : e.status === "closed",
  );
  const top = data.value_by_category.slice(0, 5);
  const hidden = data.value_by_category.length - top.length;

  return (
    <div className="grid gap-5">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard icon="events" tone="info" label="Total events" value={k.total_events} sub={`${k.open_events} still open`} />
      <KpiCard icon="cube" tone="brand" label="Items & lots" value={k.items} sub={`${k.vendors} vendors on record`} />
      <KpiCard icon="coin" tone="amber" label="Total value" value={moneyCompact(k.total_value)} sub="Quoted where bids exist, else reference" />
      <KpiCard
        icon="trend"
        tone="ok"
        label="Potential savings / uplift"
        value={moneyCompact(k.potential_total)}
        sub={`${moneyCompact(k.potential_savings)} savings · ${moneyCompact(k.potential_uplift)} uplift`}
      />
      <KpiCard icon="events" tone="info" label="Open events" value={k.open_events} sub="Not yet closed" />
      <KpiCard icon="vendors" tone="brand" label="Vendors" value={k.vendors} sub="Suppliers and scrap buyers" />
      <KpiCard icon="chat" tone="amber" label="Negotiations in progress" value={k.negotiations_in_progress} sub="Items being negotiated or awaiting approval" />
      <KpiCard
        icon="check"
        tone="ok"
        label="Completed negotiations"
        value={k.completed_negotiations}
        sub={`${moneyCompact(k.realised_total)} generated`}
      />
    </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid min-w-0 content-start gap-5">
        <Panel
          title="Events"
          subtitle="Buy carts and scrap sales, with the value on the table and where they stand."
          flush
          actions={
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter events">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    filter === f.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        >
          <EventsTable events={events.slice(0, 10)} empty="No events in this filter." />
          <div className="flex items-center justify-between px-5 py-3 text-xs text-muted">
            <span>
              Showing {Math.min(10, events.length)} of {events.length}
            </span>
            <Link href="/events" className="font-semibold text-brand hover:underline">
              View all events
            </Link>
          </div>
        </Panel>
      </div>

      <div className="grid content-start gap-5">
        <Panel title="Value by category" subtitle="Share of total quoted value">
          <Donut
            label="Value by category"
            centerTop={moneyCompact(k.total_value)}
            centerBottom="Total value"
            segments={top.map((c, i) => ({ label: c.category, value: c.share, color: SERIES[i % SERIES.length] }))}
            total={1}
          />
          <div className="mt-4">
            <Legend
              rows={top.map((c, i) => ({
                color: SERIES[i % SERIES.length],
                label: c.category.replace(/^\d+ - /, ""),
                right: `${pct(c.share, 0)} · ${moneyCompact(c.value)}`,
              }))}
            />
            {hidden > 0 && <p className="mt-2 text-xs text-muted">+ {hidden} smaller categories</p>}
          </div>
        </Panel>

        <Panel title="Top vendors by quoted value">
          <ol className="grid gap-3">
            {data.top_vendors.map((v, i) => (
              <li key={v.vendor_id} className="flex items-center gap-3">
                <Avatar name={v.vendor_name} index={i} />
                <Link href={`/vendors/${v.vendor_id}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                  {v.vendor_name}
                </Link>
                <span className="text-right text-sm tabular-nums">
                  <span className="block font-semibold text-ink">{moneyCompact(v.value)}</span>
                  <span className="text-xs text-muted">{pct(v.share)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Negotiation opportunities" subtitle="Best quote is still short of your target">
          {data.opportunities.length === 0 ? (
            <p className="text-sm text-muted">No open opportunities yet. Analyze quotes on an event to see them here.</p>
          ) : (
            <ul className="grid gap-3">
              {data.opportunities.slice(0, 5).map((o) => (
                <li key={o.item_id}>
                  <Link href={`/items/${o.item_id}`} className="block rounded-m border border-line2 p-3 hover:border-brand">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-ink">{o.description}</span>
                      <DirectionBadge direction={o.direction} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{o.title}</span>
                      <Delta value={o.potential_delta} direction={o.direction} label />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pipeline & results">
          <StackBar
            label="Events by status"
            segments={[
              { label: "Received", value: data.status_distribution.received ?? 0, color: "var(--info)" },
              { label: "In progress", value: data.status_distribution.in_progress ?? 0, color: "var(--amber)" },
              { label: "Closed", value: data.status_distribution.closed ?? 0, color: "var(--ok)" },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line2 pt-4 text-sm">
            <div>
              <div className="text-xs text-muted">Savings generated</div>
              <div className="font-bold text-ok tabular-nums">{money(data.delta_generated.savings)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Uplift generated</div>
              <div className="font-bold text-ok tabular-nums">{money(data.delta_generated.uplift)}</div>
            </div>
          </div>
        </Panel>

        {data.insight && (
          <div className="rounded-l border border-line bg-brand-soft p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-m bg-panel text-brand">
                <Icon name="bulb" />
              </span>
              <div className="min-w-0 text-sm">
                <b className="block text-ink">Negotiation insight</b>
                <p className="mt-1 text-text">
                  {data.insight.description} has the widest gap between vendor bids ({pct(data.insight.spread)}). A good
                  opportunity for price optimisation.
                </p>
                <Link href={`/items/${data.insight.item_id}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  Open item
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
```

**File:** `frontend/app/events/page.tsx`

```tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EventsTable } from "@/components/events/EventsTable";
import { inputClass, Panel } from "@/components/ui/basics";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";
import { useEffect, useState } from "react";

function EventsInner() {
  const params = useSearchParams();
  const { range } = useRange();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  const { data, error, loading, reload } = useApi(
    () => api.events({ q, direction, status, from: range.from, to: range.to }),
    [q, direction, status, range.from, range.to],
  );

  return (
    <>
      <PageHeader title="Events" subtitle="Every buy cart and scrap lot, newest first." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search id, title, category, requestor, cart no, item…"
            aria-label="Search events"
            className={`${inputClass} max-w-sm`}
          />
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">All types</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">All statuses</option>
            <option value="received">Received</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} events</span>}
        </div>
        {loading && !data && <Loading label="Loading events" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {data && <EventsTable events={data} empty="No events match these filters." />}
      </Panel>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<Loading label="Loading events" />}>
      <EventsInner />
    </Suspense>
  );
}
```

**File:** `frontend/app/events/[id]/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Delta, DirectionBadge, KpiCard, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { api, type EventDetail, type ItemView } from "@/lib/api";
import { dateShort, money, moneyCompact, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import {
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
  STATE_LABEL,
  STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  deltaLabel,
} from "@/lib/labels";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function Body({ data }: { data: EventDetail }) {
  const e = data.event;
  const closed = e.status === "closed";
  const columns: Column<ItemView>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <Link href={`/items/${i.id}`} className="font-semibold text-brand hover:underline">
          {i.description}
        </Link>
      ),
    },
    { key: "qty", header: "Qty", align: "right", cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "bids", header: "Quotes", align: "right", hideOnMobile: true, cell: (i) => i.bid_count },
    { key: "best", header: "Best quote", align: "right", cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    { key: "target", header: "Target", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{money(i.target)}</span> },
    { key: "gap", header: "Gap / unit", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{i.gap == null ? "—" : money(i.gap)}</span> },
    {
      key: "potential",
      header: `Potential ${deltaLabel(e.direction).toLowerCase()}`,
      align: "right",
      cell: (i) => <Delta value={i.potential_delta} direction={e.direction} />,
    },
    { key: "state", header: "Status", cell: (i) => <Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill> },
    {
      key: "rec",
      header: "Recommendation",
      hideOnMobile: true,
      cell: (i) => <Pill tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (i) => (
        <Link href={`/items/${i.id}`} className="rounded-m border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand">
          Open
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/events" className="hover:underline">Events</Link> / {e.id}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.title}
            <DirectionBadge direction={e.direction} />
            <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
          </span>
        }
        subtitle={e.category}
      />

      {!e.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">
            Not eligible for negotiation: {e.eligibility.reason}. You can review it, but negotiation points cannot be confirmed.
          </Notice>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="cube" tone="brand" label="Items" value={e.item_count} />
        <KpiCard icon="vendors" tone="info" label="Vendors" value={e.vendor_count} sub="Invited or responded" />
        <KpiCard icon="coin" tone="amber" label={closed ? "Final value" : "Quoted value"} value={moneyCompact(closed ? (e.final_value ?? e.quoted_value) : e.quoted_value)} sub={`Reference ${moneyCompact(e.reference_value)}`} />
        <KpiCard
          icon="trend"
          tone="ok"
          label={closed ? `${deltaLabel(e.direction)} achieved` : `Potential ${deltaLabel(e.direction).toLowerCase()}`}
          value={moneyCompact(closed ? e.realised_delta : e.potential_delta)}
        />
      </div>

      {closed && (
        <div className="mb-5">
          <Panel title="Closed summary" subtitle="What this event delivered">
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <Meta label="Reference value" value={money(e.reference_value)} />
              <Meta label="Final value" value={money(e.final_value)} />
              <Meta label={`${deltaLabel(e.direction)} achieved`} value={money(e.realised_delta)} />
              <Meta label="Items negotiated" value={`${e.items_negotiated} / ${e.item_count}`} />
              <Meta label="Negotiation time" value={`${e.duration_minutes} min · ${e.vendors_participated} vendors`} />
            </dl>
          </Panel>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Items" subtitle="Every item is actionable: open it to set points, see quotes and compare vendors." flush>
          <DataTable columns={columns} rows={data.items} rowKey={(i) => i.id} />
        </Panel>
        <Panel title="Details">
          <dl className="grid gap-3 text-sm">
            <Meta label="Plant / company" value={`${e.plant} · ${e.company}`} />
            <Meta label="Purchasing" value={`${e.purch_org} · ${e.purch_group}`} />
            <Meta label="Requestor" value={e.requestor} />
            <Meta label="Cost centre" value={e.cost_centre} />
            <Meta label="Created" value={dateShort(e.created)} />
            <Meta label="Approved" value={dateShort(e.approval_date)} />
            <Meta label="Due" value={dateShort(e.due)} />
            <Meta label="Source cart" value={e.source_cart_no ?? "Scrap sale (no cart)"} />
          </dl>
        </Panel>
      </div>
    </>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi(() => api.event(id), [id]);
  if (loading && !data) return <Loading label="Loading event" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return data ? <Body data={data} /> : null;
}
```


- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: `tsc` prints nothing; `next build` ends with a route table that includes `/`, `/events` and `/events/[id]` and no errors.

- [ ] **Step 3: Look at it in a browser**

Start the backend (`cd backend && python -m uvicorn app.main:app --port 8000`, with `NEGOTIATION_CORS_ORIGINS` set if the frontend is not on port 3000) and the frontend (`npm run dev` or `npm run start -- -p 3100`). Check:
- Dashboard shows 8 KPI cards in two rows of four across the full width at 1440px (85 events, 81 open, 189 items, 46 vendors, about ₹ 2.7 Cr total value), the events table, the category donut with a legend, top vendors, opportunities, pipeline bar and the insight card.
- "Simulate event" creates EVT-2026-086 and shows a link to it; the total events KPI becomes 86.
- `/events` filters by text, type and status; `/events/EVT-2026-041` shows 6 items, 5 vendors and a value of ₹ 3.18 L.
- Theme toggle switches light and dark and survives a reload; the date-range menu filters the dashboard and shows an error for From after To.
- At 375px wide: no horizontal page scroll; the sidebar opens from the menu button.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/shell frontend/components/events frontend/app
git commit -m "Add the app shell, the dashboard, the events list and the event detail page."
```

---

### Task 6: Item page (points, quotes, comparison, history)

**Files:**
- Create: `frontend/components/item/Stepper.tsx`, `PointsPanel.tsx`, `OpportunityPanel.tsx`, `ComparisonMatrix.tsx`, `HistoryTab.tsx`, `frontend/app/items/[id]/page.tsx`

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces: `/items/[id]` with a lifecycle stepper, the negotiation-points panel (target, ceiling or floor, objective; save and confirm; backend errors shown verbatim), the opportunity panel (best quote, target, limit, gap, quantity, potential; recommendation pill; disabled "Start negotiation"), the quotes tab (invited vendors, "Collect vendor responses (demo)", side-by-side comparison matrix with best-quote and best-overall highlights, "Analyze quotes"), the history tab (stats, price trend chart with target, limit and best-quote lines, table) and the outcome panel for closed items.

- [ ] **Step 1: Create the files below exactly**


**File:** `frontend/components/item/Stepper.tsx`

```tsx
import type { ItemState } from "@/lib/api";
import { STEPS } from "@/lib/labels";

export function Stepper({ state }: { state: ItemState }) {
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.states.includes(state)),
  );
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < current || state === "closed";
        const active = i === current && state !== "closed";
        return (
          <li key={s.key} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                done ? "bg-ok text-white dark:text-[#07130f]" : active ? "bg-brand text-white dark:text-[#07130f]" : "bg-raise text-muted"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-sm ${active ? "font-bold text-ink" : done ? "font-medium text-text" : "text-muted"}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-line sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}
```

**File:** `frontend/components/item/PointsPanel.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { api, type ItemDetail, type Objective } from "@/lib/api";
import { money } from "@/lib/format";
import { limitLabel, objectiveOptions } from "@/lib/labels";
import { Button, Field, inputClass, Panel } from "@/components/ui/basics";
import { Notice } from "@/components/ui/State";

const EDITABLE = ["draft", "points_reviewed", "analyzed", "handed_back"];

export function PointsPanel({
  detail,
  eventDirection,
  onChanged,
}: {
  detail: ItemDetail;
  eventDirection: "buy" | "sell";
  onChanged: () => Promise<void>;
}) {
  const item = detail.item;
  const [target, setTarget] = useState(String(item.target));
  const [limit, setLimit] = useState(String(item.limit));
  const [objective, setObjective] = useState<Objective | "">(item.objective ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTarget(String(item.target));
    setLimit(String(item.limit));
    setObjective(item.objective ?? "");
    setSaved(false);
  }, [item.id, item.target, item.limit, item.objective]);

  const editable = EDITABLE.includes(item.state);
  const canConfirm = item.state === "draft";
  const eligible = detail.value_eligibility.eligible;
  const lim = limitLabel(eventDirection);

  const parsed = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const valid = parsed(target) > 0 && parsed(limit) > 0;

  const run = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.setPoints(item.id, { target: parsed(target), limit: parsed(limit), objective: objective || null });
      if (confirm) await api.confirmPoints(item.id);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Negotiation points" subtitle="You set the targets. The bot never goes beyond your limit.">
      <div className="grid gap-4">
        {!item.points_set && (
          <Notice tone="info">
            Suggested from history: target {money(item.target)}, {lim.toLowerCase()} {money(item.limit)}. Adjust and confirm.
          </Notice>
        )}
        {!eligible && <Notice tone="amber">{detail.value_eligibility.reason}. Points cannot be confirmed for this event.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target price" hint="Per unit">
            <input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label="Target price"
            />
          </Field>
          <Field label={`${lim} (walk-away)`} hint="Never shown to vendors">
            <input
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={!editable || busy}
              className={inputClass}
              aria-label={`${lim} price`}
            />
          </Field>
        </div>
        <Field label="Negotiation objective">
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as Objective | "")}
            disabled={!editable || busy}
            className={inputClass}
          >
            <option value="">No preference</option>
            {objectiveOptions(eventDirection).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {error && <Notice tone="red">{error}</Notice>}
        {saved && !error && <Notice tone="ok">Points saved.</Notice>}
        <div className="flex flex-wrap gap-2">
          {canConfirm ? (
            <Button variant="primary" disabled={!editable || busy || !valid || !eligible} onClick={() => run(true)}>
              Confirm points
            </Button>
          ) : null}
          <Button disabled={!editable || busy || !valid} onClick={() => run(false)}>
            Save points
          </Button>
        </div>
        {!editable && <p className="text-xs text-muted">Points are locked once negotiation has started.</p>}
      </div>
    </Panel>
  );
}
```

**File:** `frontend/components/item/OpportunityPanel.tsx`

```tsx
import type { ItemDetail } from "@/lib/api";
import { money, num } from "@/lib/format";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, deltaLabel, limitLabel } from "@/lib/labels";
import { Button, Delta, Panel, Pill } from "@/components/ui/basics";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line2 py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

export function OpportunityPanel({ detail }: { detail: ItemDetail }) {
  const { item, event } = detail;
  const d = event.direction;
  if (item.best_bid == null) {
    return (
      <Panel title="Negotiation opportunity">
        <p className="text-sm text-muted">Opportunity appears once vendor quotes are in.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Negotiation opportunity"
      actions={<Pill tone={RECOMMENDATION_TONE[item.recommendation]}>{RECOMMENDATION_LABEL[item.recommendation]}</Pill>}
    >
      <dl>
        <Row label="Current best quote">{money(item.best_bid)}</Row>
        <Row label="Target">{money(item.target)}</Row>
        <Row label={limitLabel(d)}>{money(item.limit)}</Row>
        <Row label="Gap per unit">{money(item.gap)}</Row>
        <Row label="Quantity">
          {num(item.qty)} {item.unit}
        </Row>
        <Row label={`Potential ${deltaLabel(d).toLowerCase()}`}>
          <Delta value={item.potential_delta} direction={d} />
        </Row>
      </dl>
      {item.within_limit && item.recommendation === "accept" && (
        <p className="mt-3 text-sm text-ok">Best quote is already within your {limitLabel(d).toLowerCase()}.</p>
      )}
      <div className="mt-4">
        <Button variant="primary" disabled className="w-full" title="The negotiation workspace arrives in the next release">
          Start negotiation
        </Button>
        <p className="mt-2 text-xs text-muted">
          The buyer always starts a negotiation. The workspace opens in the next release; until then you can prepare points and compare quotes.
        </p>
      </div>
    </Panel>
  );
}
```

**File:** `frontend/components/item/ComparisonMatrix.tsx`

```tsx
import Link from "next/link";
import type { ComparisonView, Direction } from "@/lib/api";
import { money } from "@/lib/format";
import { bestLabel, deltaLabel, limitLabel } from "@/lib/labels";
import { Pill } from "@/components/ui/basics";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

export function ComparisonMatrix({ view, direction }: { view: ComparisonView; direction: Direction }) {
  const { rows, summary } = view;
  const cell = "px-4 py-2.5 align-top whitespace-nowrap tabular-nums";
  const label = "sticky left-0 z-10 bg-panel px-4 py-2.5 text-left text-xs font-semibold text-muted whitespace-nowrap";
  const tint = (best: boolean, bestEff: boolean) =>
    best ? "bg-ok-soft" : bestEff ? "bg-brand-soft" : "";
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Best quote", money(summary.best_price)],
          ["Best overall", money(summary.best_effective_price)],
          ["Target", money(summary.target)],
          [limitLabel(direction), money(summary.limit)],
          ["Bid spread", summary.spread == null ? "—" : `${(summary.spread * 100).toFixed(1)}%`],
          [`Potential ${deltaLabel(direction).toLowerCase()}`, money(summary.potential_delta)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-m border border-line2 bg-raise px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-bold text-ink tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-m border border-line2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line2 bg-raise">
              <th className={label}>Vendor</th>
              {rows.map((r) => (
                <th key={r.bid_id} className="px-4 py-2.5 text-left align-top">
                  <Link href={`/vendors/${r.vendor_id}`} className="font-semibold text-ink hover:underline">
                    {r.vendor_name}
                  </Link>
                  <div className="text-xs font-normal text-muted">Rating {r.vendor_rating.toFixed(1)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line2 [&>tr:last-child]:border-0">
            <tr>
              <th className={label}>Unit price</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={`${cell} ${tint(r.is_best_price, false)} font-bold text-ink`}>
                  {money(r.unit_price)}
                  {r.is_best_price && (
                    <div className="mt-1">
                      <Pill tone="ok">{bestLabel(direction)} quote</Pill>
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Effective price</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={`${cell} ${tint(false, r.is_best_effective)}`}>
                  {money(r.effective_price)}
                  {r.is_best_effective && (
                    <div className="mt-1">
                      <Pill tone="brand">Best overall</Pill>
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Gap to target</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>
                  {r.gap_to_target > 0 ? money(r.gap_to_target) : <span className="text-ok">On target</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th className={label}>Payment terms</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.payment_code}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Incoterm</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.incoterm}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>{direction === "buy" ? "Lead time" : "Pickup time"}</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.delivery_days} days</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Warranty</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.warranty_months ? `${r.warranty_months} months` : "—"}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Validity</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{r.validity_days} days</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Penalty clause</th>
              {rows.map((r) => (
                <td key={r.bid_id} className="px-4 py-2.5 align-top text-xs text-text">{r.penalty_clause || "—"}</td>
              ))}
            </tr>
            <tr>
              <th className={label}>Reply language</th>
              {rows.map((r) => (
                <td key={r.bid_id} className={cell}>{LANG[r.language] ?? r.language}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Effective price adjusts each quote for payment days, freight terms, delivery time and warranty (illustrative rates), so offers with different terms can be compared fairly.
      </p>
    </div>
  );
}
```

**File:** `frontend/components/item/HistoryTab.tsx`

```tsx
"use client";

import Link from "next/link";
import { api, type ItemDetail } from "@/lib/api";
import { dateShort, money } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { limitLabel } from "@/lib/labels";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill } from "@/components/ui/basics";
import { TrendChart } from "@/components/ui/charts";
import { ErrorBox, Loading } from "@/components/ui/State";
import type { HistoryPoint } from "@/lib/api";

export function HistoryTab({ detail }: { detail: ItemDetail }) {
  const id = detail.item.id;
  const { data, error, loading, reload } = useApi(() => api.itemHistory(id), [id]);
  if (loading && !data) return <Loading label="Loading history" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  if (data.records.length === 0) return <p className="text-sm text-muted">No past deals for this item or category.</p>;

  const s = data.stats!;
  const d = detail.event.direction;
  const refs = [{ value: detail.item.target, label: "Target", color: "var(--ok)" }, { value: detail.item.limit, label: limitLabel(d), color: "var(--amber)" }];
  if (detail.item.best_bid != null) refs.push({ value: detail.item.best_bid, label: "Best quote", color: "var(--info)" });

  const columns: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "desc", header: "Item", hideOnMobile: true, cell: (h) => h.description },
    { key: "vendor", header: "Vendor", cell: (h) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_id}</Link> },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => h.qty },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    { key: "orig", header: "Before negotiation", align: "right", hideOnMobile: true, cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>) },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        {data.basis === "description" ? "Past deals for this exact item." : "No exact match; showing past deals in the same category."}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Deals", String(s.count)],
          ["Average", money(s.average)],
          ["Lowest", money(s.minimum)],
          ["Highest", money(s.maximum)],
          ["Last price", `${money(s.last_price)} · ${dateShort(s.last_date)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-m border border-line2 bg-raise px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-bold text-ink tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <TrendChart
        label="Price trend of past deals"
        points={data.records.map((r) => ({ date: r.date, price: r.unit_price, negotiated: r.negotiated }))}
        refLines={refs}
      />
      <p className="text-xs text-muted">Filled dots were negotiated; hollow dots are list-price deals.</p>
      <DataTable columns={columns} rows={[...data.records].reverse()} rowKey={(h) => h.id} dense />
    </div>
  );
}
```

**File:** `frontend/app/items/[id]/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ComparisonMatrix } from "@/components/item/ComparisonMatrix";
import { HistoryTab } from "@/components/item/HistoryTab";
import { OpportunityPanel } from "@/components/item/OpportunityPanel";
import { PointsPanel } from "@/components/item/PointsPanel";
import { Stepper } from "@/components/item/Stepper";
import { Button, DirectionBadge, Panel, Pill } from "@/components/ui/basics";
import { ErrorBox, Loading, Notice, PageHeader } from "@/components/ui/State";
import { Tabs } from "@/components/ui/Tabs";
import { api, type ItemDetail } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { STATE_LABEL, STATE_TONE, deltaLabel, partyLabel } from "@/lib/labels";

const LANG: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

function QuotesTab({ detail, onChanged }: { detail: ItemDetail; onChanged: () => Promise<void> }) {
  const { item, event, invitees, comparison } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = invitees.filter((i) => !i.responded);
  const canCollect = (item.state === "points_reviewed" || item.state === "awaiting_bids") && pending.length > 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      {error && <Notice tone="red">{error}</Notice>}

      {comparison.rows.length > 0 && (
        <>
          <ComparisonMatrix view={comparison} direction={event.direction} />
          {item.state === "bids_in" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={busy} onClick={() => act(() => api.analyze(item.id))}>
                Analyze quotes
              </Button>
              <span className="text-xs text-muted">Marks the comparison as reviewed and shows the negotiation opportunity.</span>
            </div>
          )}
          {item.state === "awaiting_bids" && (
            <Notice tone="amber">
              {item.bid_count} of the minimum 3 quotes are in. Collect more vendor responses to continue.
            </Notice>
          )}
        </>
      )}

      {(pending.length > 0 || comparison.rows.length === 0) && (
        <Panel
          title={comparison.rows.length ? "Waiting for vendors" : "Vendor responses"}
          subtitle={`${partyLabel(event.direction)}s invited to quote on this item.`}
          flush
        >
          <ul className="divide-y divide-line2">
            {invitees.map((v) => (
              <li key={v.vendor_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Link href={`/vendors/${v.vendor_id}`} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline">
                  {v.vendor_name}
                </Link>
                <span className="text-muted">Rating {v.rating.toFixed(1)}</span>
                <span className="text-muted">{LANG[v.language] ?? v.language}</span>
                <Pill tone={v.responded ? "ok" : "muted"}>{v.responded ? "Responded" : "Invited"}</Pill>
              </li>
            ))}
            {invitees.length === 0 && <li className="px-5 py-6 text-sm text-muted">No vendors invited for this item.</li>}
          </ul>
          <div className="border-t border-line2 px-5 py-4">
            {item.state === "draft" && <Notice tone="info">Confirm your negotiation points first. Vendors are invited once the points are confirmed.</Notice>}
            {canCollect && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={busy} onClick={() => act(() => api.releaseBids(item.id))}>
                  Collect vendor responses (demo)
                </Button>
                <span className="text-xs text-muted">
                  The supplier invite, consent and OTP flow arrives in the next release. For now this loads the scripted vendor replies.
                </span>
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function OutcomePanel({ detail }: { detail: ItemDetail }) {
  const o = detail.outcome;
  if (!o) return null;
  const d = detail.event.direction;
  return (
    <Panel title="Outcome" subtitle={o.negotiated ? "Negotiated deal" : "Accepted at the best quote"}>
      <dl className="grid gap-2 text-sm">
        {[
          ["Vendor", o.vendor_name],
          ["Original quote", money(o.original_price)],
          ["Final price", money(o.final_price)],
          ["Quantity", `${num(o.qty)} ${detail.item.unit}`],
          [deltaLabel(d), money(o.value_delta)],
          ["Terms", `${o.payment_code} · ${o.incoterm}`],
          ["Closed", `${dateShort(o.closed_date)} · ${o.duration_minutes} min`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line2 pb-2 last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Body({ detail, reload }: { detail: ItemDetail; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"quotes" | "history">("quotes");
  const { item, event } = detail;
  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/events" className="hover:underline">Events</Link> /{" "}
            <Link href={`/events/${event.id}`} className="hover:underline">{event.id}</Link> / {item.description}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {item.description}
            <DirectionBadge direction={event.direction} />
            <Pill tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Pill>
          </span>
        }
        subtitle={`${event.title} · ${num(item.qty)} ${item.unit} · reference ${money(item.reference_price)} per unit · ${item.incoterm}`}
      />
      <div className="mb-5 rounded-l border border-line bg-panel px-5 py-4 shadow-card">
        <Stepper state={item.state} />
      </div>
      {!event.eligibility.eligible && (
        <div className="mb-4">
          <Notice tone="amber">Not eligible for negotiation: {event.eligibility.reason}.</Notice>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel flush className="min-w-0">
          <div className="px-5">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "quotes", label: "Quotes & comparison" },
                { key: "history", label: "History" },
              ]}
            />
          </div>
          <div className="p-5">
            {tab === "quotes" ? <QuotesTab detail={detail} onChanged={reload} /> : <HistoryTab detail={detail} />}
          </div>
        </Panel>
        <div className="grid content-start gap-5">
          <OpportunityPanel detail={detail} />
          <PointsPanel detail={detail} eventDirection={event.direction} onChanged={reload} />
          <OutcomePanel detail={detail} />
        </div>
      </div>
    </>
  );
}

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi(() => api.item(id), [id]);
  if (loading && !data) return <Loading label="Loading item" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return data ? <Body detail={data} reload={reload} /> : null;
}
```


- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean, and the route table lists `/items/[id]`.

- [ ] **Step 3: Walk the hero BUY item through the UI**

With both servers running and the data freshly reset (`POST /api/admin/reset` or the Ops page):
1. Open `/items/EVT-2026-041-01`: state Draft, suggested target 250 and ceiling 270, five invited vendors.
2. "Confirm points" -> state "Points confirmed". "Collect vendor responses (demo)" -> "Quotes in" and a five-vendor matrix (best quote ₹ 285 tagged Lowest quote, best overall ₹ 282.62).
3. "Analyze quotes" -> "Analyzed"; the opportunity panel shows best quote ₹ 285, target ₹ 250, ceiling ₹ 270, gap ₹ 35, 600 EA, potential savings ₹ 21,000, "Negotiation recommended".
4. History tab: 6 deals between ₹ 262 and ₹ 275 with a trend chart.
5. Enter a target above the ceiling and Save: the API's message is shown in a red notice and nothing changes.
6. Repeat with `/items/EVT-2026-052-01` (SELL): labels read Floor and Uplift; best quote ₹ 163, target 170, floor 165, potential ₹ 35,000.
7. At 375px wide the page has no horizontal scroll; the matrix scrolls inside its box.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/item frontend/app/items
git commit -m "Add the item page with negotiation points, vendor quote comparison, price history and the opportunity panel."
```

---

### Task 7: Vendors, History, Comparison, Reports and Ops pages

**Files:**
- Create: `frontend/app/vendors/page.tsx`, `frontend/app/vendors/[id]/page.tsx`, `frontend/app/history/page.tsx`, `frontend/app/comparison/page.tsx`, `frontend/app/reports/page.tsx`, `frontend/app/ops/page.tsx`

**Interfaces:**
- Consumes: Tasks 3 to 6 and the Task 1 endpoints.
- Produces: the remaining sidebar destinations (vendor list and profile, global deal history with filters, cross-event comparison list, reports summary, ops controls with health check, simulate and reset).

- [ ] **Step 1: Create the files below exactly**


**File:** `frontend/app/vendors/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type VendorView } from "@/lib/api";
import { moneyCompact } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function VendorsPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi(() => api.vendors(), []);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");

  const rows = (data ?? []).filter(
    (v) => (!type || v.type === type) && (!q || `${v.name} ${v.sap_no} ${v.id}`.toLowerCase().includes(q.toLowerCase())),
  );

  const columns: Column<VendorView>[] = [
    {
      key: "name",
      header: "Vendor",
      cell: (v) => (
        <Link href={`/vendors/${v.id}`} className="font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
          {v.name}
        </Link>
      ),
    },
    { key: "sap", header: "SAP no.", hideOnMobile: true, cell: (v) => <span className="tabular-nums">{v.sap_no}</span> },
    {
      key: "type",
      header: "Type",
      cell: (v) => <Pill tone={v.type === "supplier" ? "info" : "amber"}>{v.type === "supplier" ? "Supplier" : "Scrap buyer"}</Pill>,
    },
    { key: "rating", header: "Rating", align: "right", cell: (v) => v.rating.toFixed(1) },
    { key: "pay", header: "Payment pref.", hideOnMobile: true, cell: (v) => v.payment_pref },
    { key: "bids", header: "Live quotes", align: "right", hideOnMobile: true, cell: (v) => v.live_bid_count },
    { key: "value", header: "Quoted value", align: "right", cell: (v) => <span className="tabular-nums">{moneyCompact(v.quoted_value)}</span> },
    { key: "deals", header: "Past deals", align: "right", hideOnMobile: true, cell: (v) => v.past_deals },
  ];

  return (
    <>
      <PageHeader title="Vendors" subtitle="Suppliers for buy carts and buyers for scrap lots." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SAP number…" aria-label="Search vendors" className={`${inputClass} max-w-sm`} />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Vendor type" className={`${inputClass} w-auto`}>
            <option value="">All vendors</option>
            <option value="supplier">Suppliers</option>
            <option value="scrap_buyer">Scrap buyers</option>
          </select>
          {data && <span className="text-xs text-muted">{rows.length} vendors</span>}
        </div>
        {loading && !data && <Loading label="Loading vendors" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={rows} rowKey={(v) => v.id} onRowClick={(v) => router.push(`/vendors/${v.id}`)} empty="No vendors match." />}
      </Panel>
    </>
  );
}
```

**File:** `frontend/app/vendors/[id]/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { KpiCard, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type HistoryPoint, type VendorDetail } from "@/lib/api";
import { dateShort, money, moneyCompact, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type BidRow = VendorDetail["recent_bids"][number];

function Body({ data }: { data: VendorDetail }) {
  const v = data.vendor;
  const bidColumns: Column<BidRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (b) => (
        <Link href={`/items/${b.item_id}`} className="font-semibold text-brand hover:underline">
          {b.description}
        </Link>
      ),
    },
    { key: "qty", header: "Qty", align: "right", cell: (b) => num(b.qty) },
    { key: "price", header: "Quote", align: "right", cell: (b) => <span className="tabular-nums font-semibold">{money(b.unit_price)}</span> },
    { key: "event", header: "Event", hideOnMobile: true, cell: (b) => <Link href={`/events/${b.event_id}`} className="text-muted hover:underline">{b.event_id}</Link> },
  ];
  const histColumns: Column<HistoryPoint>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "item", header: "Item", cell: (h) => h.description },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => num(h.qty) },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];
  return (
    <>
      <PageHeader
        crumbs={<><Link href="/vendors" className="hover:underline">Vendors</Link> / {v.id}</>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {v.name}
            <Pill tone={v.type === "supplier" ? "info" : "amber"}>{v.type === "supplier" ? "Supplier" : "Scrap buyer"}</Pill>
          </span>
        }
        subtitle={`SAP ${v.sap_no} · payment preference ${v.payment_pref}`}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="check" tone="ok" label="Rating" value={v.rating.toFixed(1)} sub="Out of 5" />
        <KpiCard icon="chat" tone="info" label="Live quotes" value={v.live_bid_count} sub={moneyCompact(v.quoted_value)} />
        <KpiCard icon="cube" tone="brand" label="Closed with us" value={v.closed_deals} />
        <KpiCard icon="history" tone="amber" label="Past deals" value={v.past_deals} sub={`${v.history_deals} in the history log`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Current quotes" flush>
          <DataTable columns={bidColumns} rows={data.recent_bids} rowKey={(b) => `${b.item_id}`} empty="No live quotes." dense />
        </Panel>
        <Panel title="Past deals" flush>
          <DataTable columns={histColumns} rows={data.history.slice(0, 15)} rowKey={(h) => h.id} empty="No past deals." dense />
        </Panel>
      </div>
    </>
  );
}

export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi(() => api.vendor(id), [id]);
  if (loading && !data) return <Loading label="Loading vendor" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return data ? <Body data={data} /> : null;
}
```

**File:** `frontend/app/history/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { DirectionBadge, inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type HistoryRow } from "@/lib/api";
import { dateShort, money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { deltaLabel } from "@/lib/labels";

export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState("");
  const [negotiated, setNegotiated] = useState("");
  const { data, error, loading, reload } = useApi(
    () => api.history({ q, direction, negotiated: negotiated === "" ? undefined : negotiated === "yes", limit: 500 }),
    [q, direction, negotiated],
  );

  const columns: Column<HistoryRow>[] = [
    { key: "date", header: "Date", cell: (h) => dateShort(h.date) },
    { key: "item", header: "Item", cell: (h) => <span className="font-semibold text-ink">{h.description}</span> },
    { key: "type", header: "Type", cell: (h) => <DirectionBadge direction={h.direction} /> },
    {
      key: "vendor",
      header: "Vendor",
      hideOnMobile: true,
      cell: (h) => <Link href={`/vendors/${h.vendor_id}`} className="text-brand hover:underline">{h.vendor_name}</Link>,
    },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (h) => `${num(h.qty)} ${h.unit}` },
    { key: "price", header: "Price", align: "right", cell: (h) => <span className="tabular-nums font-semibold">{money(h.unit_price)}</span> },
    {
      key: "before",
      header: "Before negotiation",
      align: "right",
      hideOnMobile: true,
      cell: (h) => (h.original_price == null ? "—" : <span className="tabular-nums">{money(h.original_price)}</span>),
    },
    {
      key: "gain",
      header: "Gain",
      align: "right",
      cell: (h) =>
        h.value_delta == null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="tabular-nums font-semibold text-ok">
            {money(h.value_delta)}
            <span className="ml-1 text-xs font-medium text-muted">{deltaLabel(h.direction)}</span>
          </span>
        ),
    },
    { key: "neg", header: "", cell: (h) => (h.negotiated ? <Pill tone="ok">Negotiated</Pill> : null) },
  ];

  return (
    <>
      <PageHeader title="History" subtitle="Closed deals from the last eighteen months. The bot may only cite figures found here." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item…" aria-label="Search history" className={`${inputClass} max-w-sm`} />
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">Buy and sell</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={negotiated} onChange={(e) => setNegotiated(e.target.value)} aria-label="Negotiated" className={`${inputClass} w-auto`}>
            <option value="">All deals</option>
            <option value="yes">Negotiated only</option>
            <option value="no">Not negotiated</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} deals</span>}
        </div>
        {loading && !data && <Loading label="Loading history" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={data} rowKey={(h) => h.id} empty="No deals match." dense />}
      </Panel>
    </>
  );
}
```

**File:** `frontend/app/comparison/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Delta, DirectionBadge, inputClass, Panel, Pill } from "@/components/ui/basics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type ItemRow } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, STATE_LABEL, STATE_TONE } from "@/lib/labels";

export default function ComparisonPage() {
  const router = useRouter();
  const [direction, setDirection] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const { data, error, loading, reload } = useApi(
    () => api.items({ has_bids: true, direction, recommendation }),
    [direction, recommendation],
  );

  const columns: Column<ItemRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <div className="max-w-[260px]">
          <Link href={`/items/${i.id}`} className="block truncate font-semibold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
            {i.description}
          </Link>
          <div className="truncate text-xs text-muted">{i.event_title}</div>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (i) => <DirectionBadge direction={i.direction} /> },
    { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (i) => `${num(i.qty)} ${i.unit}` },
    { key: "bids", header: "Quotes", align: "right", hideOnMobile: true, cell: (i) => i.bid_count },
    { key: "best", header: "Best quote", align: "right", cell: (i) => <span className="tabular-nums">{money(i.best_bid)}</span> },
    { key: "target", header: "Target", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{money(i.target)}</span> },
    { key: "gap", header: "Gap", align: "right", hideOnMobile: true, cell: (i) => <span className="tabular-nums">{i.gap == null ? "—" : money(i.gap)}</span> },
    { key: "delta", header: "Potential", align: "right", cell: (i) => <Delta value={i.potential_delta} direction={i.direction} /> },
    { key: "state", header: "Status", hideOnMobile: true, cell: (i) => <Pill tone={STATE_TONE[i.state]}>{STATE_LABEL[i.state]}</Pill> },
    { key: "rec", header: "Recommendation", cell: (i) => <Pill tone={RECOMMENDATION_TONE[i.recommendation]}>{RECOMMENDATION_LABEL[i.recommendation]}</Pill> },
  ];

  return (
    <>
      <PageHeader title="Comparison" subtitle="Every item with vendor quotes, biggest opportunity first. Open one to compare vendors side by side." />
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Type" className={`${inputClass} w-auto`}>
            <option value="">Buy and sell</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} aria-label="Recommendation" className={`${inputClass} w-auto`}>
            <option value="">Any recommendation</option>
            <option value="negotiate">Negotiation recommended</option>
            <option value="accept">Best quote acceptable</option>
            <option value="review">Buyer review needed</option>
            <option value="done">Done</option>
          </select>
          {data && <span className="text-xs text-muted">{data.length} items</span>}
        </div>
        {loading && !data && <Loading label="Loading comparison" />}
        {error && (
          <div className="px-5 pb-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {data && <DataTable columns={columns} rows={data} rowKey={(i) => i.id} onRowClick={(i) => router.push(`/items/${i.id}`)} empty="No items match." dense />}
      </Panel>
    </>
  );
}
```

**File:** `frontend/app/reports/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { EventsTable } from "@/components/events/EventsTable";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard, Panel } from "@/components/ui/basics";
import { ErrorBox, Loading, PageHeader } from "@/components/ui/State";
import { api, type Dashboard } from "@/lib/api";
import { moneyCompact, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useRange } from "@/lib/providers";

type Cat = Dashboard["value_by_category"][number];

export default function ReportsPage() {
  const { range } = useRange();
  const { data, error, loading, reload } = useApi(() => api.dashboard(range), [range.from, range.to]);

  const columns: Column<Cat>[] = [
    { key: "cat", header: "Category", cell: (c) => c.category },
    { key: "value", header: "Quoted value", align: "right", cell: (c) => <span className="tabular-nums">{moneyCompact(c.value)}</span> },
    { key: "share", header: "Share", align: "right", cell: (c) => pct(c.share) },
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle="What negotiation has delivered so far, for the selected dates." />
      {loading && !data && <Loading label="Loading reports" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon="coin" tone="ok" label="Savings generated" value={moneyCompact(data.delta_generated.savings)} sub="Buy events" />
            <KpiCard icon="trend" tone="ok" label="Uplift generated" value={moneyCompact(data.delta_generated.uplift)} sub="Scrap sales" />
            <KpiCard icon="check" tone="brand" label="Completed negotiations" value={data.kpis.completed_negotiations} />
            <KpiCard icon="chat" tone="amber" label="Still on the table" value={moneyCompact(data.kpis.potential_total)} sub="Potential across open items" />
          </div>
          <Panel title="Closed events" subtitle="Events finished in this period." flush>
            <EventsTable events={data.events.filter((e) => e.status === "closed")} empty="No closed events in this period." />
          </Panel>
          <Panel title="Value by category" flush>
            <DataTable columns={columns} rows={data.value_by_category} rowKey={(c) => c.category_key} dense />
          </Panel>
          <p className="text-xs text-muted">
            Prices and scrap rates are illustrative POC values. See the <Link href="/history" className="text-brand underline">history log</Link> for the deals behind the benchmarks.
          </p>
        </div>
      )}
    </>
  );
}
```

**File:** `frontend/app/ops/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Panel, Pill } from "@/components/ui/basics";
import { Notice, PageHeader } from "@/components/ui/State";
import { API_BASE, api, type Direction } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export default function OpsPage() {
  const health = useApi(() => api.health(), []);
  const [message, setMessage] = useState<{ tone: "ok" | "red"; text: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<React.ReactNode>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await fn() });
    } catch (e) {
      setMessage({ tone: "red", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const simulate = (d: Direction) =>
    run(async () => {
      const res = await api.simulate(d);
      return (
        <>
          Created <Link href={`/events/${res.event.id}`} className="font-semibold underline">{res.event.id}</Link>.
        </>
      );
    });

  const reset = () => {
    if (!window.confirm("Reset all demo data back to the seed? Anything you changed will be lost.")) return;
    void run(async () => `Demo data reset (${(await api.reset()).events} events).`);
  };

  return (
    <>
      <PageHeader title="Ops" subtitle="Demo controls and system status." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="API status">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="font-semibold text-ink">{API_BASE}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Health</dt>
              <dd>
                {health.loading && !health.data && <Pill tone="muted">Checking…</Pill>}
                {health.data && <Pill tone="ok">Healthy</Pill>}
                {health.error && <Pill tone="red">Unreachable</Pill>}
              </dd>
            </div>
          </dl>
          {health.error && <p className="mt-3 text-sm text-red">{health.error}</p>}
          <Button className="mt-4" size="sm" onClick={() => void health.reload()}>
            Check again
          </Button>
        </Panel>
        <Panel title="Demo data" subtitle="Everything here is mock data for the proof of concept.">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void simulate("buy")}>Simulate BUY event</Button>
            <Button disabled={busy} onClick={() => void simulate("sell")}>Simulate SELL event</Button>
            <Button variant="danger" disabled={busy} onClick={reset}>Reset demo data</Button>
          </div>
          {message && (
            <div className="mt-4">
              <Notice tone={message.tone}>{message.text}</Notice>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
```


- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean, with all eleven routes in the table.

- [ ] **Step 3: Check each page in the browser**

- `/vendors`: 46 vendors, search and type filter; a vendor row opens a profile with rating, live quotes, closed deals and two tables.
- `/history`: 305 deals, newest first; "Negotiated only" shows a Gain column value on every row.
- `/comparison`: items with quotes ranked by potential; a row opens the item page.
- `/reports`: savings and uplift KPIs, closed events table, value by category.
- `/ops`: shows Healthy; Simulate BUY event creates an event; Reset asks for confirmation and restores the seed.
- No page logs errors in the browser console.

- [ ] **Step 4: Commit**

```bash
git add frontend/app
git commit -m "Add the vendors, history, comparison, reports and ops pages."
```

---

### Task 8: README and end-to-end verification

**Files:**
- Create: `frontend/README.md`
- Modify: `assumptions.txt` (append)

- [ ] **Step 1: Write the README**


**File:** `frontend/README.md`

````markdown
# Negotiation bot frontend

Next.js 14 (App Router), TypeScript, Tailwind CSS. Talks to the FastAPI backend in `../backend`.

## Run

```bash
# terminal 1: API
cd backend
python -m uvicorn app.main:app --port 8000

# terminal 2: web
cd frontend
npm install
npm run dev            # http://localhost:3000
```

If port 3000 is busy, run the frontend elsewhere and allow that origin on the API:

```bash
# API
NEGOTIATION_CORS_ORIGINS=http://localhost:3100 python -m uvicorn app.main:app --port 8000
# web
npm run dev -- -p 3100
```

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) if the API is not at `http://localhost:8000`.

## Checks

```bash
npm run typecheck
npm run build
```

There is no frontend test runner in this POC; behaviour is covered by the backend tests and a browser walk-through (see the Phase 3 plan).

## When the API changes

```bash
cd backend && python scripts/export_openapi.py
cd ../frontend && npm run gen:types
```
The backend test `test_openapi_drift` fails until `backend/openapi.json` is regenerated.

## Conventions

- All money comes from the API; the UI only formats it (`lib/format.ts`).
- Wording that differs between buy and sell (Savings/Uplift, Ceiling/Floor) lives in `lib/labels.ts`.
- Colours are CSS variables from the reference theme (`app/globals.css`), light and dark.
- Charts are hand-rolled SVG in `components/ui/charts.tsx`.
````


- [ ] **Step 2: Clean-checkout verification**

From a fresh clone (or after `git clean -fdx frontend`):

```bash
cd backend && python -m pytest -q -p no:asyncio
cd ../frontend && npm ci && npx tsc --noEmit && npm run build
```
Expected: 217 backend tests pass; `tsc` clean; production build succeeds.

- [ ] **Step 3: Full demo pass (both hero events)**

Reset the data on `/ops`, then follow the Task 6 walk-through for `EVT-2026-041-01` and `EVT-2026-052-01`, then confirm on the dashboard that "Potential savings / uplift" and "Open events" still match the API (`GET /api/dashboard`). Check light and dark themes and a 375px viewport on the dashboard and the item page.

- [ ] **Step 4: Record assumptions**

Append to `assumptions.txt` (next free numbers; keep the format):
- Frontend is a client-rendered Next.js 14 app fetching the API from the browser; no server components with data.
- The frontend never computes money; chart geometry is the only arithmetic. The category donut shows the top five categories using the API's shares; the remainder stays as the track.
- "Start negotiation" is disabled until the negotiation phase; "Collect vendor responses (demo)" loads the scripted replies and stands in for the supplier invite, consent and OTP story.
- Date range filters events by their creation date and is stored in the browser (localStorage) only.
- API origin allow-list defaults to localhost:3000 and is extended with `NEGOTIATION_CORS_ORIGINS`; port 3000 was found in use by an unrelated project on the developer machine.
- Response types are generated from `backend/openapi.json`; a backend test fails when the file is stale.

- [ ] **Step 5: Commit**

```bash
git add frontend/README.md assumptions.txt
git commit -m "Add the frontend README and record the frontend assumptions."
```

---

## Self-Review

- **Spec coverage (Phase 3 scope):** app shell with sidebar, topbar, date range, search and theme toggle (Task 5); dashboard per the reference layout with all required KPIs, events table, donut, top vendors, opportunities, status distribution, savings/uplift generated and insight card (Task 5); event detail with item table and closed summary (Task 5); vendor comparison matrix with best quote, target, gap and best commercial option, plus the opportunity panel (Task 6); history tab with price trend (Task 6); negotiation points with direction-aware labels (Task 6); vendors, history, comparison, reports and ops pages (Task 7); light and dark themes and phone widths (Tasks 3, 5, 8). Not in Phase 3 by design: supplier invite/consent/OTP story, negotiation workspace, result, approval, closed flow and export (Phases 4 and 5).
- **Placeholder scan:** none; every file is given in full.
- **Type consistency:** components import types from `lib/api.ts`, which derives them from the generated OpenAPI file; `ItemView.within_limit`, `Invitee.responded` and the `EventView` closed-summary fields used by the pages exist in the Phase 2 schemas.
