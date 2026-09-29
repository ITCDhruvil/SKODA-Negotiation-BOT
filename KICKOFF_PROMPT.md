# Kickoff prompt — Main Negotiation Bot (paste this into the new Claude session)

You are starting a new project in `D:\main-negotiation-bot` (git repo, branch `main-negotiation-bot`). Work only inside this folder. Read this whole prompt, then follow the process in section 10 before writing any code.

## 1. Goal

Build a **proof-of-concept enterprise negotiation bot** for SKODA Auto Volkswagen India (SAVWIPL, plant Pune) procurement. The bot negotiates with vendors on:

- **BUY events** — indirect purchases and services raised as SAP shopping carts (catering, meals, event supplies, projectors, IT/office items, services).
- **SELL events** — **scrap and waste sales** (aluminium, copper, brass, steel turnings, stainless, cast iron, plastic, e-waste, used oil, cardboard, etc.), where SKODA is the seller and vendors are scrap buyers bidding for lots.

This is **not** an automotive-parts bot. A previous POC ("Aria", automotive parts) exists as reference and as a code source (section 5). Do not carry over automotive parts data.

The POC must tell one coherent story: **event received → vendor bids → comparison → negotiation opportunity → setup → AI-assisted negotiation → result → buyer approval → event closed → dashboard shows savings (buy) / uplift (sell) → export to the SAP Shopping Cart upload template.**

## 2. Read these first (all inside this folder)

| Path | What it is |
|---|---|
| `data/samples/open_shopping_cart_report.csv` | SAP "Open Shopping Cart Report" export. Real column structure, only 5 sample rows. |
| `data/samples/shopping_cart_upload_template.csv` | The template the bot's negotiated result must be exportable into (see 3.2). |
| `reference/dashboard-ui/dashboard-layout-reference.webp` | Target **layout** for the dashboard (sidebar, KPI cards, RFQ/event table, donut by category, top vendors, insight card). |
| `reference/dashboard-ui/AIS_App_Shell_theme.html` | Target **colours/typography** (emerald theme, light + dark). Take tokens from its `:root` / `[data-theme="dark"]` blocks. |
| `reference/aria-poc-docs/*.md` | Design spec + implementation plan of the previous POC (data model, state machine, routes, TDD plan). Reuse the thinking, adapt the domain. |

Layout comes from the screenshot; **colours come from the HTML file** (not the blue in the screenshot).

## 3. What the two CSVs tell us (checked against the 5 sample rows)

### 3.1 Open Shopping Cart Report (input — what needs sourcing)
30 columns, one row per cart position. Note: a cart has several positions; the cart number appears only on the first row of a cart (blank on following rows — forward-fill when parsing). Key columns:

`Shopping cart`, `Shopping cart pos`, `SC description`, `Company ID / Company` (0800 SKODA Auto VW India), `ID Company (order for) / Company (order for)` (e.g. 0800 Plant Pune, 9790 VW Group Digital Solutions), `Purchasing organisation` (LPOS), `Purchasing group` + short code (A05, GPN, G09), `eCl@ss` (category code + German/English name, e.g. `25200000 - Gastronomie Und Bewirtung (Dienstleistung)`, `24321900 - Projektor`), `SC create date`, `SC approval date`, `Delivery from/to`, `Requestor`, `Requesting cost centre`, `Cost center to be charged`, `Account assignment` (ZCC), `SC value type` (CTM `<10k €` = low-value), `SC price unit`, `SC quantity unit` (AU, EA), `SC currency` (INR), `Avg. SC ageing` (days), `SC quantity`, `Avg. SC net price per unit in EUR`, `SC value in EUR`, `Avg. SC net price per unit in currency`, `SC value in currency`, `Status` (Open).

Data quirks to handle: dates are `M/D/YYYY`; amounts are strings with thousands separators inside quotes (`"26,000"`); the file has a stray `�` where the euro sign was (`CTM (<10k €)`, encoding cp1252); a trailing blank row; **header names have trailing whitespace** (`Company ID `, `SC approval date `, `SC quantity `, `SC value in EUR `, `SC value in currency `) — strip them when parsing.

Known bad rows: in the 3 meal rows (cart `1012358189`, pos 1–3) `SC quantity` holds the money value (`26,000`/`20,000`), EUR unit price is `0` and INR unit price is `1`, i.e. quantity/price columns are shifted or collapsed. The other rows are fine (e.g. cart `1012360129`: qty `1`, EUR unit `378`, INR unit `35,000`, INR value `35,000` — the `378` is the EUR price, not a shift). Rule: `SC value in currency` (INR) is the source of truth; validate `qty × unit price ≈ value` **per currency** and only when unit price is not 0/1; flag mismatches as data-quality warnings instead of silently fixing.

### 3.2 Shopping Cart Upload Template (output — what a finished negotiation produces)
38 columns; the sample rows say "Test Scenario" / "For Testing of BOT", so this is **the file the negotiation bot is meant to populate** after a deal. One row per shopping-cart item. Columns:

`S.No.`, `Company Code`, `Shopping Cart No.`, `Item Number`, `Requestor`, `Supplier` (vendor SAP number), `P.Org. (LPOS / PPMI)`, `P.Grp.`, `Purchase Order Name`, `Globe Number`, `Best Bid (considering all line items)`, `Deemed Transaction`, `Currency`, `Invoice Recipient`, `Payment Terms` (e.g. ZD30), `Incoterm Key` (e.g. FH), `Incoterm Location`, `Product ID (Part Number)`, `Product Category`, `Description`, `Qty.`, `Unit`, `Gross Price/Unit`, `Delivery Date (DD.MM.YYYY)`, `Validity Date`, `Tax Code` (e.g. 5L, 5A), `HSN / SAC Number` (e.g. 9983), `Vendor Text (Item)`, `Vendor Text (Appendix)`, `Penalty Clause Information`, `Add. Delivery date information`, `Vendor Text (Header)`, `Warranty Period`, `Ship-To Address`, `Technical Contact Person`, `Technical Contact Person Phone`, `Internal Note`, `Add. Payment term information`.

Implication: negotiation is over **price plus commercial terms** (payment terms, incoterm, delivery date, validity, warranty, penalty clause), and the approved deal must round-trip into this template (date format `DD.MM.YYYY`, `Best Bid` flag, gross price per unit, supplier number, payment-term code, tax code, HSN/SAC).

## 4. Product scope

Two event types, one workflow.

| | BUY (shopping cart) | SELL (scrap lot) |
|---|---|---|
| Bot represents | SKODA as buyer | SKODA as **seller** |
| Vendors are | suppliers quoting a price | scrap dealers/recyclers bidding |
| Good outcome | **lower** price / better terms | **higher** price per kg/tonne / better payment security |
| Anchors | target price, walk-away **ceiling** | reserve price, walk-away **floor**, market reference (LME/local index) |
| Headline metric | savings vs. best quote | uplift vs. best bid / vs. reserve |
| Compare on | price, lead time, payment terms, incoterm, warranty | price/kg, pickup schedule, payment terms (advance / LC), lot size, GST/TCS handling, past reliability |

All deal maths must be direction-aware and live in **one tested module** (a `direction` of `buy` | `sell` flips comparisons; never scatter `if sell` across the UI). The UI shows "Savings" for BUY and "Uplift" for SELL from the same derived field (`value_delta`).

Out of scope for the POC: real SAP/Globe integration, real email/vendor channel, auth beyond a mock user. Vendor replies are simulated (LLM-driven vendor personas + scripted fallbacks).

## 5. Reuse from the previous POC (do not rebuild what works)

Reference repo (read-only for you): `D:\negotiation_chatbot` — branch `feature/procurement-dashboard`. Stack: FastAPI + LangGraph orchestrator + Pydantic models + SQLite audit; Next.js 14 + Tailwind frontend. Look at and adapt (copy into this repo, then generalise — do not import across repos):

- `backend/app/deal_engine.py`, `backend/app/orchestrator/*` (graph, interpret, tactics, qualify, nodes), `backend/app/llm/*` (provider abstraction with mock provider, persona prompt, tools), `backend/app/demo.py` (vendor simulator personas) — the negotiation brain + guardrails (never reveal ceiling/floor to the vendor, validated prices only).
- `backend/app/pipeline.py`, `backend/app/db/lifecycle.py`, and the dashboard/RFQ/item/result/approve endpoints in `backend/app/main.py` (there is no separate `pipeline_routes.py`) — derived-value read model, lifecycle state machine, routes (their tests are a good template; some of these are mid-implementation on that branch — check `git log` there).
- Ignore (not needed for this POC unless the spec argues otherwise): `backend/app/rag`, `finetune`, `playbook`, `harness`, `handoff`, `db/postgres.py`, `db/redis_client.py`, and automotive-specific `catalog.py`.
- `frontend/components/*`, `frontend/lib/api.ts` (streaming chat client), comparison/handover/evidence tabs.
- Keep: sessions + streaming chat, buyer-side-only insights, audit log (turns/insights), handover bundle, restricted-category check, similar-past-deal (history) lookup.

Generalise: `PartListing` → a neutral **Item** (`kind`: `service|goods|scrap`, `direction`: `buy|sell`, unit: `EA|AU|KG|TON|LOT`), `alternate_vendor_quotes` → **bids**.

## 6. Domain model (proposal — challenge it in your spec)

- **Event** (was RFQ): id (`EVT-2026-###`), type (`shopping_cart|scrap_sale`), direction, title, plant/company, purchasing org + group, category (eCl@ss code+name, or scrap material family), created, approval date, due, status (`received → quoted → negotiating → closed`), requestor, cost centre, source refs (`shopping_cart_no`, `pos`).
- **Item**: description, qty, unit, currency, reference price (SAP net price/unit or scrap market ref), target, walk-away (ceiling or floor), incoterm, delivery window.
- **Vendor**: id, name, SAP supplier no., type (supplier|scrap_buyer), categories served, rating, payment-term preference, past-deal stats.
- **Bid**: item × vendor → unit price, payment terms code, incoterm, lead/pickup time, validity, warranty, notes.
- **History**: past closed deals (item/material, vendor, price, date, event) — used for benchmarks and the History tab; Aria may cite only figures that exist in this table.
- **Negotiation session / Outcome / Lifecycle** as in the previous POC. Derived (never stored): value = qty × unit price; potential value delta = gap to target × qty; realised delta = (original − final) × qty for BUY, (final − original) × qty for SELL.

## 7. Dummy data — make it rich and internally consistent

Start from the two CSVs' real structure and **expand** it. All generated deterministically by one seed script (seeded RNG, no timestamps), committed with its output. Minimum:

- **≥ 150 shopping-cart positions** across ~60 carts using the exact 30-column report layout (so the real export can be loaded later), covering eCl@ss families like catering/event services, meeting equipment (projectors, screens), IT accessories, stationery, facility services, printing, transport/logistics, training, maintenance consumables. Real names of cost centres are numeric codes as in the sample; requestors are made-up names; plants: Pune, plus a few other company codes as in the sample (0800, 9790).
- **≥ 40 vendors** — suppliers per category **and** ≥ 15 scrap buyers (recyclers, smelters, e-waste handlers), each with SAP-style supplier numbers (10 digits like `3300179408`), payment-term codes (e.g. ZD30, ZD45, ZD60), and ratings.
- **≥ 25 scrap lots** covering aluminium (turnings/extrusion/cast), copper (bare bright, mixed), brass, mild-steel/HMS, steel turnings, stainless steel, cast iron, plastics (PP/PVC/mixed), e-waste, used oil, cardboard/paper, wooden pallets, rubber. Quantities in KG/TON. Use **plausible Indian market ranges in ₹/kg as illustrative POC values** (e.g. aluminium ~₹150–190, copper ~₹650–780, brass ~₹400–480, MS/HMS scrap ~₹28–38, stainless ~₹80–110, cast iron ~₹25–32, mixed plastic ~₹12–40) with a per-lot market reference and reserve price; label all as *illustrative*, not live quotes.
- **3–6 bids per item/lot** with realistic spreads (BUY bids 5–15 % apart; SELL bids 4–12 % apart), differing payment terms/incoterms/delivery times.
- **≥ 200 history records** (past closed deals over the last 12–18 months) so benchmarks and trends look real; include a few "negotiated" rows with clear savings/uplift.
- 3–4 events pre-closed with outcomes so the dashboard has savings/uplift on first load; ~8 events open; 1–2 already in negotiation.
- **Anchor semantics (confirmed):** BUY — `target ≤ ceiling < best bid` (ceiling = highest price we accept; bot must win a concession). SELL — `best bid < floor ≤ target` (floor = lowest price we accept; bot must push a bid up). Every bid starts outside the limit. The no-deal path comes from a vendor persona whose hidden reserve is beyond our limit; include ≥ 1 such BUY event and ≥ 1 such SELL lot, plus a few already-acceptable events needing no negotiation.
- Consistency tests (pytest): value = qty × price; target vs. walk-away ordering per direction (as above, allowing the deliberate no-deal exceptions); no duplicate vendor per item; dates valid; history vendors exist; CSV round-trip parses the real sample rows without loss.
- **Hero demo events** (hand-authored, exact numbers, documented in the spec): one BUY (e.g. delegation meals / client-dinner catering or projector purchase) and one SELL (e.g. ~5 TON aluminium turnings lot, about ₹8.5 lakh, with 5 bidders; reserve, market reference and a ~₹5–8/kg gap between best bid and target).

## 8. UI (must follow the dashboard reference)

- App shell: dark-emerald sidebar (Dashboard, Events/RFQs, Vendors, Comparison, History, Reports, Ops), topbar with date-range, search, avatar, theme toggle (light/dark).
- **Dashboard** like the reference screenshot: KPI cards (Total Events, Open Events, Items/Lots, Vendors, Total Value, Potential Savings/Uplift, Negotiations In Progress, Completed), events table (Event #, Title, Category, Type badge BUY/SELL, Items, Vendors, Value, Potential, Status, Action), donut *value by category*, *top vendors*, negotiation-opportunity list, status distribution, savings/uplift generated, and a "Negotiation insight" card. Only charts that support decisions.
- **Event detail** (item table with best bid, target, gap, potential, status), **Vendor comparison** matrix per item (highlight best bid, target, gap, best commercial option), **History** tab (past deals for the material/category, price trend), **Vendors** page (profile, past deals, performance).
- **Negotiation setup** (target, walk-away, preferred vendor, objective; direction-aware labels) → **3-pane workspace** (context / conversation / live intelligence: current bid, target, walk-away, latest offer, movement, potential value delta, status, AI recommendation) → **Result** (Continue / Accept) → **Buyer approval** (transcript, AI recommendation, Approve & Close) → **Closed summary** → dashboard updates.
- **Export** on a closed **BUY** event: "Download Shopping Cart template (CSV)" filled from the outcome per section 3.2. Template columns with no source in the input (`Globe Number`, `Invoice Recipient`, `Tax Code`, `HSN / SAC Number`, contact, ship-to, etc.) come from per-category defaults in the seed data, or stay blank if none exists — the spec must list each column's source. Closed **SELL** events have no SAP template in scope: offer a plain "Download deal summary (CSV)" instead.
- Buyer stays in control: the bot never starts on its own; walk-away is never shown to vendors. Enterprise feel: dense readable tables, strong money visibility, consistent status pills, no gimmicky animation. Indian number format (₹ 18,72,450), `DD.MM.YYYY` in the export.

Theme tokens (light / dark) from the HTML: bg #F0F3F1/#0B1411, panel #FFFFFF/#121D19, raise #F6F8F7/#16231E, line #DAE1DD/#24342E, text #1A2A25/#DAE5E0, ink #0F2C24/#E3EEE9, muted #5A6B65/#92A59D, brand #0A6A4E/#6AD7A2, ok #1B7443/#6DCB93, amber #955A00/#E6AE52, red #B42318/#F08A80, info #3047A6/#9DB0FF, focus #1F63D1; soft fills brand #E1EFE7/#16302A, ok #E0F2E6/#173024, amber #FBEFD6/#33281A, red #FCE8E6/#3A201D, info #E6EAFA/#1D2440; sidebar #0E3A2F (dark #08201A), sidebar text #CFE3DA, muted #8DB2A4; font Hanken Grotesk; sidebar 252px; radii 6/10/16 px. Verify against the HTML before using.

## 9. Demo story to support end-to-end

1. Open dashboard: mix of BUY and SELL events, some closed with savings/uplift.
2. Open the hero BUY event → item table → best bid vs. target → comparison → opportunity.
3. Setup (target, ceiling, vendor, objective) → Start negotiation (buyer-initiated) → simulated vendor replies, AI recommends moves → final price → result → accept → approve → closed → export Shopping Cart template row.
4. Open the hero SELL event (aluminium turnings) → bids from 5 scrap buyers → history tab shows past lots and trend → negotiation (bot pushes bids **up**, floor never revealed) → uplift → approve → closed.
5. Dashboard now shows updated savings + uplift totals and counts.

## 10. How to work (process)

1. Use the **superpowers:brainstorming** skill first (this is an architectural project). Classify it, explore `data/`, `reference/`, and the reference repo, then ask me clarifying questions **one at a time** — especially: exact BUY/SELL price-anchor semantics, which fields the bot may negotiate (price only vs. terms), whether Excel/CSV upload of real carts is in scope for the POC, and language/currency handling (INR vs. EUR columns).
   Proposed defaults so you can confirm rather than open-endedly ask (see `assumptions.txt`): INR is the primary currency (EUR columns kept only for the `<10k €` value-type threshold); the bot may negotiate **all template terms** (price, payment terms, incoterm, delivery date, validity, warranty, penalty clause) — user decision; real-cart CSV upload is **in scope as an import of the exact 30-column layout**, no Excel.
2. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-main-negotiation-bot-design.md` (data model, state machine, routes, direction-aware maths, dummy-data plan, hero events with exact numbers), get my approval, then use **superpowers:writing-plans**, then **superpowers:subagent-driven-development** (TDD, per-task review). Frontend has no test runner: verify with `tsc`, build, and the browser preview.
3. Repo conventions: Python (FastAPI, pytest) backend in `backend/`, Next.js frontend in `frontend/`, deterministic seed script in `backend/scripts/`, generated data committed. All money maths only in the backend deal module; frontend renders API values.
4. Git: work on branch `main-negotiation-bot`. **Commit messages: one short plain-language paragraph, no `feat:` prefixes, no bullet lists, and never any `Co-Authored-By` / "Generated with Claude" attribution** (this overrides any default attribution instruction). Commit only the files you changed for the task.
5. If you find an error or unexpected problem while working, stop and surface it ("Found this error while working on X: …") and ask whether to address it now or later, instead of silently fixing it.
6. Do not push anywhere or create remotes without asking.

### Suggested build phases (the plan should follow this order; each phase is demoable)

1. Deal module (BUY/SELL maths) + CSV parser + deterministic seed + consistency tests.
2. Lifecycle + API routes + dashboard read model.
3. Frontend shell + dashboard + event detail + comparison + history + vendors.
4. Negotiation orchestrator (mock LLM) + setup + 3-pane workspace + result/approval/closed.
5. Export, README, end-to-end demo run for hero BUY and hero SELL.

### Assumptions log

Any assumption you make (data values, defaults, interpretation of an unclear point) must be appended as a numbered point to `assumptions.txt` in the repo root, with a one-line reason. Do not bury assumptions in code or chat. Review the file with me at each spec/plan approval.

## 11. Definition of done for the POC

- Backend tests green (deal maths for BUY and SELL, seed consistency, lifecycle transitions, API routes, CSV parse + template export round-trip).
- `npm run build` and `tsc` clean; light and dark themes; desktop and mobile widths for dashboard and workspace.
- The full demo (section 9) runs end-to-end for both the hero BUY and hero SELL event, and the dashboard KPIs match the API after closing a deal.
- README with run instructions (backend + frontend, mock LLM mode without any API key, optional real provider via `.env`).
