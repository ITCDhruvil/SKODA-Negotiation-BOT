# Main Negotiation Bot: design

POC for SKODA Auto Volkswagen India (SAVWIPL, Pune). One story: points set, buyer review, vendors respond, bot analyses quotes, buyer starts negotiation, bot negotiates and recommends, buyer approves, outcome recorded, dashboard updated, BUY export to the Shopping Cart template.

Companion file: `assumptions.txt` (numbered; cited below as A<n>). Source brief: `KICKOFF_PROMPT.md`.

## 1. Scope

- **BUY** events: indirect purchases and services from SAP shopping carts. Bot represents SKODA as buyer.
- **SELL** events: scrap and waste lots. Bot represents SKODA as seller.
- Eligibility (Module 3): Phase 1 = INR 2,000 to 3.5 lakh with at least 2 bids; Phase 2 = up to INR 10 lakh with at least 3 bids. Phase is a config value (A17). Scrap lots sized to fit (A24).
- Out of scope: real SAP/Globe, real email/SMS/WhatsApp/OTP, auth beyond a mock user, Excel upload, automotive parts data (A39).
- Bot never places an order; buyer approval is the last step (A18).

## 2. Architecture

```
backend/   FastAPI, pytest, SQLite
  app/deal.py           pure BUY/SELL maths; the only place direction flips
  app/models.py         Event, Item, Vendor, Bid, History, Session, Turn, Outcome
  app/lifecycle.py      item state machine; event status derived
  app/importer.py       Open Cart Report CSV parser
  app/exporter.py       Shopping Cart template (BUY), deal summary (SELL)
  app/eligibility.py    band and min-bid check
  app/negotiation/      interpret, tactics, guardrails, graph, mock LLM (ported piecemeal from Aria, A27)
  app/routes.py         REST + streaming
  scripts/seed.py       deterministic seed, output committed
frontend/  Next.js 14, Tailwind
  app shell, dashboard, event/item/comparison/history/vendors, setup, workspace, approval, closed
  lib/story/            supplier-side story only (A28)
```

Rules:
- All money maths in `deal.py`. UI renders API values and never computes deltas.
- The story layer (invite channel, consent, mock OTP, hours, EN/HI/MR scripted lines) is frontend-only, keeps state in client memory, and calls the backend only to post the resulting bids and to start a negotiation (A28, A30).
- Backend enforces band, minimum bids, and ceiling/floor guardrails (A29). The walk-away price is never sent to vendors.
- Approach B: fresh core with tests first; Aria pieces ported one at a time (A27).

## 3. Data model (INR)

- **Event**: id `EVT-2026-###`, type `shopping_cart|scrap_sale`, direction `buy|sell`, title, company/plant, purchasing org and group, category (eCl@ss or scrap family), requestor, cost centre, dates, source cart no. and position, derived status.
- **Item**: description, qty, unit `EA|AU|KG|TON|LOT`, kind `service|goods|scrap`, reference price, `target`, `limit` (BUY ceiling / SELL floor), buyer negotiation points and objective, state.
- **Vendor**: id, name, 10-digit SAP no., type `supplier|scrap_buyer`, categories, rating, payment preference, past-deal stats.
- **Bid**: item x vendor (unique), unit price, payment code, incoterm, delivery/pickup days, validity, warranty months, penalty clause, language.
- **History**: past closed deals; the bot may cite only these figures.
- **Session / Turn / Outcome**: transcript, final terms, original vs final price, timestamps for duration.
- **Derived, never stored**: value = qty x price; potential delta = gap to target x qty; realised delta (`value_delta`) = (original - final) x qty for BUY, (final - original) x qty for SELL; effective price (below).

### Effective price (A15)
`effective = price x (1 - carry x payment_days/365) + incoterm_adj + warranty_adj + delay_adj`, all rates in one illustrative config (carry 12% p.a., warranty 0.2% per extra month). Later payment lowers present value: on BUY, longer credit lowers our effective cost; on SELL, longer credit lowers our effective revenue, so SELL rewards advance/short cycles. The matrix highlights best effective price; raw price stays visible.

### Anchors (A7 to A9)
- BUY: `target <= ceiling < best bid` at start. Ceiling is the highest acceptable price.
- SELL: `best bid < floor <= target` at start. Floor is the lowest acceptable price; the bot must push a bid up to it.
- Both directions: every bid starts outside the limit, so negotiation is required. The no-deal path comes from a vendor persona whose hidden reserve is beyond our limit; seed includes at least one such BUY event and one SELL lot, plus a few already-acceptable events that need no negotiation (A9).

## 4. State machine (A31 to A34)

Item: `draft -> points_reviewed -> awaiting_bids -> bids_in -> analyzed -> negotiating -> result_pending -> awaiting_approval -> closed`, plus `handed_back` (offer outside limits or no deal; buyer may re-setup or close without deal). `Continue` returns `result_pending -> negotiating`. Bids arriving move `awaiting_bids -> bids_in` only when the minimum-bids rule is met. Negotiation never starts without a buyer click. Event status is derived: `received` (all draft), `in_progress`, `closed` (all items closed or handed back and resolved).

Supplier states (`not_invited, invited, consented, otp_verified`) exist only in the frontend story (A28).

## 5. Hero events (A40, A41)

**BUY `EVT-2026-041`**, delegation meals (eCl@ss 25200000): 6 positions, 5 suppliers, total about INR 3.2 lakh (reference value INR 3.18 lakh, Phase 1 band). Hero item: lunch buffet, 600 meals; bids per meal 285 / 292 / 298 / 305 / 312; target 250; ceiling 270. Potential = (285 - 250) x 600 = INR 21,000. Scripted run: counter 275, AI advises 270, agreed 270 with payment ZD45. Realised = (285 - 270) x 600 = INR 9,000. Other positions fixed by the seed under the same consistency rules; 3 of 6 negotiated in the closed summary.

**SELL `EVT-2026-052`**, aluminium turnings, 5,000 kg: bids INR/kg 163 / 162 / 161.5 / 158 / 154; market reference 165; floor 165; target 170 (illustrative). Best bid value about INR 8.15 lakh. Potential = (170 - 163) x 5,000 = INR 35,000. Scripted run: counter 166, AI pushes to 168, agreed. Realised uplift = INR 25,000. Every bid starts below the floor; bid 154 is far below and is declined. Floor never shown to vendors.

## 6. Seed data (deterministic, committed)

- 60 carts, 150+ positions in the exact 30-column report layout; 3 to 4 not-eligible cases.
- 40+ vendors including 15+ scrap buyers; SAP-style numbers; payment codes ZD30/ZD45/ZD60.
- 25+ scrap lots across aluminium, copper, brass, HMS, turnings, stainless, cast iron, plastics, e-waste, used oil, cardboard, pallets, rubber; 2 to 3 outside the bands.
- 3 to 6 bids per item (BUY spread 5 to 15%, SELL 4 to 12%).
- 200+ history rows over 12 to 18 months.
- Events at every stage: about 8 at draft/awaiting_bids, 2 analyzed, 1 to 2 negotiating, 3 to 4 closed with outcomes (including no-deal cases).
- Importer parses the real sample: cp1252, stripped headers, forward-filled cart number, per-currency qty x price check skipping unit price 0/1, warnings for the three meal rows (A5, A6).

## 7. API

`GET /dashboard`, `/events`, `/events/{id}`; `PUT /items/{id}/points`; `POST /items/{id}/confirm-points`, `/bids`, `/analyze`; `GET /items/{id}/sessions`, `/events/{id}/sessions`, `/sessions/{id}`; `POST /items/{id}/negotiations`, `/items/{id}/continue`, `/items/{id}/accept-deal`, `/items/{id}/close-without-deal`; `PUT /sessions/{id}/mode`; `POST /sessions/{id}/advance`, `/sessions/{id}/drafts/{draft_id}/approve`, `/sessions/{id}/drafts/{draft_id}/discard`, `/sessions/{id}/messages`, `/sessions/{id}/accept-offer`, `/sessions/{id}/hand-back` (auto mode is a client loop on `advance`; there is no streaming); `POST /events/{id}/approve`; `GET /events/{id}/export`; `POST /events/simulate` (A36).

Export: BUY produces the 38-column Shopping Cart template, dates `DD.MM.YYYY`, best-bid flag, gross price/unit, supplier no., payment code, tax code and HSN/SAC; columns without an input source use per-category seed defaults or stay blank (A11). SELL produces a plain deal summary CSV (A12).

## 8. UI

- Shell: emerald sidebar 252px (Dashboard, Events, Vendors, Comparison, History, Reports, Ops), topbar with date range, search, avatar, light/dark toggle. Tokens from `reference/dashboard-ui/AIS_App_Shell_theme.html`; font Hanken Grotesk; radii 6/10/16.
- Dashboard per reference layout: KPI cards (Total Events, Open Events, Items/Lots, Vendors, Total Value, Potential Savings/Uplift, Negotiations In Progress, Completed), events table with BUY/SELL badge, donut value by category, top vendors, negotiation opportunities, status distribution, savings/uplift generated, insight card. "Simulate Event" action.
- Event detail, item page (points form with objective, bids, comparison matrix, history tab), supplier-story page (channel pick, consent, mock OTP, hours with demo override, EN/HI/MR), 3-pane workspace (context / conversation / live intelligence), result (Continue / Accept), approval, closed summary (original and final value, savings or uplift, items negotiated x/y, vendors, duration).
- Indian number format (INR 18,72,450). Direction-aware labels ("Savings"/"Uplift") from the one `value_delta` field.
- Components: AppShell, Sidebar, Topbar, ThemeToggle, KpiCard, StatusPill, DataTable, Money, DeltaBadge, OpportunityCard, PointsForm, BidMatrix, InviteStory, NegotiationWorkspace, ResultSummary, ApprovalReview, ClosedSummary. Charts hand-rolled SVG.

## 9. Error handling

- Importer: warnings list (never silent fixes); bad rows are reported and kept flagged.
- Ineligible item (band or too few bids): start disabled with reason shown.
- Negotiation: any offer or request outside limits stops the bot and sets `handed_back` (A19). Guardrails validate every price the bot proposes.
- LLM provider failure: falls back to the scripted mock provider; the audit log records the fallback.
- Frontend story: state loss on reload is expected (A28).

## 10. Testing

- Backend pytest: deal maths for BUY and SELL, effective price, seed consistency (value = qty x price; anchor ordering with deliberate exceptions; no duplicate vendor per item; dates valid; history vendors exist), importer round-trip on the real sample rows, eligibility, lifecycle transitions, API routes, exporter round-trip.
- Frontend (no test runner): `tsc`, `npm run build`, browser walk-through of the 18-step demo for both hero events in light and dark, desktop and mobile widths; dashboard KPIs must match the API after closing a deal.
- Mock LLM mode works with no API key; a real provider is optional via `.env`.

## 11. Build phases (A14)

1. Deal module, importer, seed, consistency tests.
2. Lifecycle, API, dashboard read model.
3. Frontend shell, dashboard, event/item/comparison/history/vendors.
4. Negotiation engine (mock LLM), supplier story, setup, workspace, result, approval, closed.
5. Export, README, end-to-end run for both hero events.
