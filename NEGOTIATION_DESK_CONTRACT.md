# Negotiation Desk: integration contract for AIS (Phase 0 findings)

Source of these findings: the Desk's own code in this repository (`backend/app`, `frontend`), its OpenAPI file (`backend/openapi.json`) and its tests. The live site `https://negotiation-web.onrender.com` was **not** driven; it should be checked against this note (cold start up to about a minute).

The AIS files checked: `AIS Prototype V2.html` and `AIS Prototype · Increment 11 · QA pass (62_62) 1 (negotiation linked) (1).html` are byte-identical. Neither has a `NegDesk` adapter or any call to the Desk's API; the only link today is the iframe (`NEG_BASE`, `negHubHTML`).

## 1. What the Desk already offers

| Need | Desk today |
|---|---|
| Create an event from an AIS case | `POST /api/handoff` ("Open AIS case"), idempotent by `case_no` (same body again returns the same event and session) |
| Read the event and its items | `GET /api/events/{event_id}`, `GET /api/items/{item_id}` (`outcome`, `latest_session_status`, `comparison`) |
| Read a negotiation | `GET /api/sessions/{id}` (`status` = `active`, `agreed`, `handed_back`; `round`; `agreed_price`; `turns`; `handback_reason`; `from_ais`) |
| List negotiations of an event | `GET /api/events/{event_id}/sessions`, `GET /api/negotiations` |
| Final result of an item | `ItemDetail.outcome`: `vendor_id`, `qty`, `original_price`, `final_price`, `value_delta`, `negotiated`, `payment_code`, `incoterm`, `closed_date`, `tenure_months` |
| Contract / export for a closed event | `GET /api/events/{event_id}/contract`, `GET /api/events/{event_id}/export` |
| Embed in the AIS frame | `?embed=1&theme=light\|dark`; the Desk posts `{negHeight}` to the parent, accepts `{negTheme}` |
| Health | `GET /api/health` |

No login, token or cookie is needed. All routes are open to any caller whose browser origin passes CORS.

## 2. What `POST /api/handoff` takes today (`HandoffIn`, extra fields are **rejected**)

```
case_no (3-40)  supplier_id  topic (2-160)  target  limit  entity="E1"  cart_no  requestor  cost_centre
suppliers[1..20]: { sid, name, lang: en|hi|mr, total, rating 0-5, payment_code }
```

Returns `{ event_id (= case_no), item_id (= case_no + "-01"), session_id }`.

Behaviour that matters for AIS:
- The whole cart becomes **one item (one lot, quantity 1)** priced as each supplier's **cart total**. Cart positions and per-position unit prices are not carried.
- One bid per supplier. The first conversation starts with `supplier_id`; a later call with another `supplier_id` opens a conversation for that supplier.
- `target` is the Buyer's minimum price to aim for, `limit` is the maximum to pay. `target > limit` gives 409.
- Event metadata is fixed in code: company "SKODA Auto VW India", plant "Plant Pune", purch org "LPOS (SAVWIPL)", group "A05", due in 14 days, delivery 14 days, incoterm FH, validity 30 days.
- The supplier's walk-away price is generated from the supplier id (demo), never sent to AIS.

## 3. Mapping AIS to the handoff (what can be built now, with no Desk change)

| Handoff field | AIS source |
|---|---|
| `case_no` (idempotency key) | `r.lb.cmp.comparison_id` (or the NegBot case no. `nb.no`) |
| `topic` | `r.topic` |
| `entity`, `cart_no` | `r.entity`, `r.sc` |
| `requestor`, `cost_centre` | Initiator **role** (not the name), the cart cost centre |
| `suppliers[].sid / name / lang` | `cmp.sup[]` joined to `DB.supplier` (`_id`, `supplier_name`, `language`) |
| `suppliers[].total` | `lbTotals(cmp,false)` per supplier, in **INR** (the Desk has no currency field, so convert with `rate` first) |
| `target`, `limit` | the guardrail inputs (`grInUse()`); needs a rule for AIS (open question 3) |
| `supplier_id` | `cmp.award` before negotiation (the lowest supplier) |

Result back (read by polling): `GET /api/sessions/{session_id}` for state and `agreed_price`; `GET /api/items/{item_id}` for `outcome`.

| Desk | AIS |
|---|---|
| session `agreed` | `cmp.version_type="BOT_NEGOTIATED"`, `cmp.status="SENT_FOR_APPROVAL"`, `cmp.award`, evidence document, history, `moveNext(r)` to step 34 |
| session `handed_back` (`handback_reason`) | keep step 33 with the Buyer, show the reason |
| session `active` | show "In negotiation", round number |

## 4. Gaps that need the Desk developer (this repo)

1. **Per-position prices are lost.** The handoff is one lot per case with a cart total. AIS needs one item per cart position with each supplier's unit price per position. Needs: `items[]` (position, description, qty, unit) and `bids[]` (supplier, position, unit_price) on the handoff, and per-position results.
2. **Result per position and supplier.** The agreed price is for one session (one supplier, one item). AIS needs the final unit price per supplier and position, plus the recommended supplier, in **one** read: suggest `GET /api/handoff/{case_no}/result`.
3. **CORS.** `NEGOTIATION_CORS_ORIGINS` allows only listed origins (default `localhost:3000`). A page opened from disk sends `Origin: null`, and a static host has its own origin. The AIS origin must be added, and `null` is not safe to allow. The API is a separate service (`negotiation-api`), not the web address.
4. **Callback or message.** No webhook; the embed bridge only sends `{negHeight}`. For push, the Desk would post `{type:"neg:eventResult", external_ref, result}` to its parent frame.
5. **Currency and tenure.** No currency field (INR assumed). Handoff has no tenure; AIS has none either today.
6. **Documents.** Offers and SFO files are not accepted; send file metadata only.
7. **Status enum.** The Desk has `agreed` and `handed_back` only; AIS wants Agreed, Failed, Excluded, Escalated. Mapping needed (`handed_back` with a reason code).
8. **Persistence on Render.** `NEGOTIATION_DB=/tmp/app.db`; data is re-seeded on every restart. Events created from AIS are lost when the service sleeps and restarts, so AIS must treat `event_id` as re-creatable (the idempotent handoff makes that safe).
9. **API base address.** The API address is `NEXT_PUBLIC_API_URL` of the web service and is not known from this repository.

## 5. Recommended transport

**B: direct HTTPS from AIS to the API, with polling**, once the AIS origin is in `NEGOTIATION_CORS_ORIGINS`. It needs no Desk code change for the first version (one-lot handoff), the handoff is already idempotent, and results are readable. **A (postMessage)** needs new code on the Desk. Phase 1 builds the `NegDesk` adapter with a simulated transport, so the mapping and the UI can be finished and tested before CORS and the per-position change are in place.

## 6. Open questions

1. Which file do I patch: `AIS Prototype V2.html`, or the Increment 11 file? They are the same bytes; and where do the patched copy, the backup and this note live?
2. May this repository (the Desk) be changed for gaps 1, 2 and 3? Your brief says not to modify the Desk, but this repository is the Desk.
3. Where do `target` and `limit` come from in AIS? The guardrail masters do not obviously give a price pair.
4. Where will AIS be hosted (origin for CORS), and what is the real API address?

---

## 7. Built (Phase 1 to 3) and how to demo

Decisions taken: patch `AIS Prototype V2.html` (backup next to it: `AIS Prototype V2.backup-before-neg-integration.html`); the Desk (this repository) was changed; the Buyer's minimum and maximum default to 92% of the lowest offer and the lowest offer in INR (`NegDesk.cfg.targetPct`, to be replaced when the business defines them); AIS served on `http://localhost:8765`, API on `http://localhost:8000`, web on `http://localhost:3000`.

### Desk changes (this repository)
- `POST /api/handoff` takes optional `items[]` (position, description, qty, unit) and `offers[]` (supplier, position, unit price). Each position becomes an item, each supplier price a bid, the Buyer's points are split across items by share, and one conversation per position is opened with the chosen supplier. Without them it behaves as before. The reply adds `sessions[]`. Missing prices, duplicate positions or unknown suppliers give 409.
- `GET /api/handoff/{case_no}/result`: `status` (`not_started`, `in_negotiation`, `agreed`, `partly_agreed`, `failed`), `rounds`, per item and supplier `initial_unit_price` and `negotiated_unit_price`, per supplier `initial_total` and `negotiated_total`, `recommended_supplier`, `handback_reason`. Unknown case gives 404.
- CORS: `http://localhost:8765` and `http://127.0.0.1:8765` are allowed by default. For another host set `NEGOTIATION_CORS_ORIGINS`.
- Tests: `backend/tests/test_handoff.py` (9 pass); the full suite passes (698).

### AIS changes (`AIS Prototype V2.html`)
- New `NegDesk` adapter before the boot line: `buildEvent(r)`, `createEvent(r, nb)` (idempotent, timeout, retry with back-off, "Desk is starting" message), `getStatus(r)`, `apply(r, result)`, polling every 6 s while a negotiation is open, `NegDesk.mode` ("desk" default, "simulate" keeps the old behaviour; Admin switch on the request), all settings in `NegDesk.cfg`.
- Wrapped: `lbToBot` (desk mode creates the internal NegBot row and the event, simulate mode is untouched), `caseStatus`, `whoAt`, `P6_WS[33]`, and `openCase` (inside the detail-page layer). New state: `r.lb.neg` (`external_ref`, `state`, `event_id`, `url`, `sessions`, `sent_at`, `last_sync`, `round`, `error`, `map`) and `nb.desk`.
- `NEG_BASE` points to `http://localhost:3000` when AIS is opened from localhost, otherwise to the deployed web address.
- Result handling: agreed gives per-position negotiated prices in `cmp.lines[].neg`, `BOT_NEGOTIATED`, award, evidence document, history, internal NegBot case closed as `COMPLETED` with the saving, the request moved to step 34. Failed gives the Buyer step 33 (internal case `FAILED`). Partly agreed shows "Escalated" and notifies the Buyer.
- Savings are computed in AIS from initial and negotiated totals.

### Tested
Happy path (event created with the right position, three suppliers and totals; agreed in the Desk; AIS at step 34; saving 11,397), failed path (Buyer back at step 33), Desk unreachable (clear error, retry works), two sends at once (one event), five roles across GP, FSK, Reports and Desk pages with no script errors, no horizontal overflow, `node --check` passes. Not tested: the 1024, 820 and 390 px sweeps, dark theme, the Reports Negotiation Bot tab after a Desk result, and the live Render deployment.

### Run it
```
cd backend  && python -m uvicorn app.main:app --port 8000
cd frontend && npm run dev                         # port 3000
cd <folder with the AIS file> && python -m http.server 8765 --bind 127.0.0.1
```
Open `http://localhost:8765/<AIS file>`, sign in as **persona.buyer.e1** (BUYER, E1). Open request **AIS-E1-2026-00087** (cart 1012358207, eligible). On its step 33 page choose "Run the check again" (or open it from the record). The request shows "In NegBot" with a Negotiation Desk box and an event reference; **Open event in the Negotiation Desk** shows the event under Events. Finish the negotiation in the Desk (Negotiations, approve or accept the offer). Back in AIS press **Refresh status** (or wait six seconds): the request moves to step 34 with the negotiated prices.

### Still open
- Where `target` and `limit` come from (92% rule is a placeholder).
- Offer and SFO files are not sent (metadata only is not sent either yet).
- Render: the Desk database is temporary; an event lost in a restart is sent again automatically (idempotent) and the negotiation starts over.
- Production hosting of AIS and the API address: set `NEGOTIATION_CORS_ORIGINS` and `NegDesk.cfg.API`.
- A request already FAILED or AGREED in the Desk is not re-sent; a new attempt needs a new comparison id.

### Update: files, details, conversation and contract link
- Desk: `POST /api/handoff` takes `details[]` (label, value) shown on the event page under "From the AIS request". `POST /api/handoff/{case_no}/documents` stores a file (base64 JSON, up to 6 MB; the same name for the same supplier replaces it). `GET /api/events/{id}/ais` lists details and files, `GET /api/documents/{id}/download` returns the file. The result now includes `messages[]` (the conversation).
- AIS: a file chosen on the offer or SFO upload is kept (browser storage) and sent as it is. A seeded or older request, whose file AIS never kept, sends a summary PDF built from the offer data (marked "summary built by AIS" in the Desk). The comparison sheet is sent as a PDF. The request box shows "Files sent n of m" and a "Send files again" button.
- Back to AIS: each Desk round adds a history entry; the conversation is saved in the request's NegBot messages; the evidence count is filled; a "Contract document" entry links to the Desk contract page, which opens once the deal is approved in the Desk (Buyer: accept deal, approve event).
- Tested: real file and four summary PDFs reached the Desk and download; details listed; agreed result returned 8 messages, a round entry and the contract link, and the request moved to step 34.
