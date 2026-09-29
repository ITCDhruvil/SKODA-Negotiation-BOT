# Procurement dashboard and end-to-end negotiation flow — design

## Goal
Redesign the first page as an enterprise procurement dashboard and build one coherent flow:
RFQ received → review → vendor quotes → comparison → opportunity → setup → AI negotiation → result → buyer approval → RFQ closed → dashboard updated with savings.

## Decisions
- Negotiation engine: reuse the real Aria engine (sessions, streaming, deal_engine, guardrails). Vendor side uses the existing demo vendor simulator (`/api/demo/vendor-turn`).
- Theme: new app shell everywhere (dashboard, RFQ, comparison, negotiation, approval, /rfq/new, /rfq/review, /ops).
- Data: backend-owned single source of truth. No frontend-only mock layer.

## Existing state (inspected)
Next.js 14 + Tailwind; FastAPI + LangGraph; SQLite audit; RAG. Routes: `/`, `/rfq/new`, `/rfq/review`, `/chat?part=`, `/ops/*`. Catalog `backend/data/mock_catalog.json` has one vendor per part plus `alternate_vendor_quotes`; buyer target/ceiling per part. Existing "approved" means RFQ reviewed/unlocked, distinct from the new final deal approval (name the new one `deal_approved`).

## Theme (from AIS_Prototype_Increment_3_Step7_App_Shell.html)
Font Hanken Grotesk. Sidebar 252px, radii 6/10/16. Tokens, light / dark:
bg #F0F3F1/#0B1411; panel #FFFFFF/#121D19; raise #F6F8F7/#16231E; line #DAE1DD/#24342E; text #1A2A25/#DAE5E0; ink #0F2C24/#E3EEE9; muted #5A6B65/#92A59D; brand #0A6A4E/#6AD7A2; ok #1B7443/#6DCB93; amber #955A00/#E6AE52; red #B42318/#F08A80; info #3047A6/#9DB0FF; focus #1F63D1.
Soft fills: brand-soft #E1EFE7/#16302A; ok-soft #E0F2E6/#173024; amber-soft #FBEFD6/#33281A; red-soft #FCE8E6/#3A201D; info-soft #E6EAFA/#1D2440.
Sidebar always emerald #0E3A2F (dark #08201A), text #CFE3DA, muted #8DB2A4.
CSS variables + Tailwind mapping; dark via `[data-theme]` with a toggle. Green = brand/savings, amber = negotiation gap, red = over ceiling.

## Data model
- RFQ: id, title, plant, category, created, due, status, derived totals.
- Item: part_id, name, qty, target, ceiling, quotes[] (vendor, price, lead_time_days, payment_terms), neg_status, outcome? (vendor, final_price, session_id, original_price).
- Derived, never stored:
  - quoted value = qty × best quote (dashboard totals sum best quote per item)
  - potential saving = max(0, best quote − target) × qty, when gap is meaningful
  - final saving = (original − final) × qty
- Seed: 12 RFQs, ~120 items, ~40 vendors, 8 categories (Electrical & Chassis, Braking, Engine, Fuel System, Suspension, Interior, Cooling, Body Components). Generated deterministically by a script into the catalog. RFQ-2026-041 has 6 items / 5 vendors; Front Chassis Frame: 20 units, best ₹57,800, target ₹55,000.
- Lifecycle state persisted in SQLite (uses existing /tmp overlay on Vercel).

## State machine
- RFQ: RECEIVED → IN_REVIEW → QUOTED → NEGOTIATING → CLOSED.
- Item: NO_ACTION | OPPORTUNITY → SETUP → NEGOTIATING → RESULT_PENDING → APPROVED; Continue Negotiation returns RESULT_PENDING → NEGOTIATING.
- Accept Deal: RESULT_PENDING → awaiting buyer approval. Approve & Close: item APPROVED, RFQ CLOSED once all negotiated items resolved; writes outcome; dashboard KPIs recompute.
- Negotiation never starts automatically; buyer must click Start.

## Routes
`/` dashboard; `/rfqs`; `/rfq/[id]`; `/rfq/[id]/item/[partId]` (comparison + opportunity); `.../setup`; `/negotiate/[sessionId]` (3 panes: context / conversation / intelligence); `.../result`; `/rfq/[id]/approve`; `/rfq/[id]/closed`. Restyled: `/rfq/new`, `/rfq/review`, `/ops/*`. `/chat` redirects to the workspace.

## Dashboard
KPIs: total RFQs, open RFQs, items, vendors, total quoted value, potential savings, negotiations in progress, completed negotiations. RFQ table (RFQ#, title, category, items, vendors, quoted value, potential savings, status, action). Charts (hand-rolled SVG, no new deps): value by category, top vendors, negotiation opportunities, savings generated, status distribution. All from one server-side KPI endpoint.

## Components
Shell: AppShell, Sidebar, Topbar, ThemeToggle. Primitives: KpiCard, StatusPill, DataTable, Money, SavingsBadge. Screens: OpportunityCard, QuoteMatrix, SetupForm, NegotiationWorkspace, ResultSummary, ApprovalReview, ClosedSummary. ChatWidget streaming logic extracted into a reusable hook.

## Build order
1. Theme + shell. 2. Seed data + backend model + KPI API. 3. Dashboard. 4. RFQ detail + comparison. 5. Setup + negotiation workspace. 6. Result, approval, closed. 7. Dashboard reflects outcomes. 8. Restyle /rfq/new, /rfq/review, /ops.

## Testing
pytest: derived-value maths, seed consistency (quoted = qty × quote), state transitions. Browser run of the full 18-step demo at the end.

## Open risks
Live Aria result price is not deterministic; demo targets ₹56,000 via ceiling/target config and the vendor simulator. Verify during step 5.
