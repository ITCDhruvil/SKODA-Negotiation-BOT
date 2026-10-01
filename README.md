# Negotiation Desk (POC)

Proof of concept for SKODA Auto Volkswagen India: negotiate shopping-cart (buy) events and scrap lots (sell) with vendors, with the buyer in control.

Flow: event received, vendor quotes in, comparison, opportunity, points set, negotiation, result, buyer approval, closed, dashboard savings or uplift, export.

## Run it

```bash
# API (port 8000)
cd backend
pip install -e ".[dev]"
python -m uvicorn app.main:app --port 8000

# Web (port 3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. `POST /api/admin/reset` (or the Settings page) restores the seed data. LLM settings are not needed: all decisions and wording are rule-based. Backend env names are listed in `backend/.env.example`.

## Demo story (for clients)

Open **Demo story** in the sidebar for a guided, nine-step walk through the whole process, with a purchase story and a scrap story. Each step explains what happens and why it matters, shows the live data on the right, and has one button that does the step for real: restart, set the goals, collect vendor responses, analyse the quotes, start the negotiation (it then plays out as a live chat that a person can stop and take over), accept the result, approve and close, then download the SAP Shopping Cart template (or the scrap deal summary) and see the savings on the dashboard. The steps follow the real state of the item, so reloading the page resumes where you were, and any finished step can be revisited with Back and Next.

## Demo script (manual)

**Hero BUY** (`EVT-2026-041`, Delegation Lunch Buffet, 600 EA)
1. Open the item, set target 250 and ceiling 270, confirm the points.
2. Use "Simulate response" on a vendor (mock invite, consent and code 123456), or "Load all scripted replies". Analyze the quotes.
3. Start negotiation in Full auto. It opens at 250, the vendor first explains why it cannot move, then the two sides trade offers over five rounds (we reach 257, 262, 265, 270; the vendor 280, 277, 275) and it agrees at 270 with 45-day payment: savings 9,000. "Keep negotiating" pushes on and lands at 269.
4. Accept the deal, review and approve the event, then download the Shopping Cart template (CSV) from the event page.

**Hero SELL** (`EVT-2026-052`, scrap lot): target 170, floor 165. Try Approve each message or Manual. It takes four rounds and agrees at 167: uplift 20,000 ("Keep negotiating" reaches 168). Closed sell events export a plain deal summary.

## Behaviour to know

- Messages to vendors read like a colleague wrote them (a name, varied wording, English, Hindi or Marathi). Nothing mentions software, and a guardrail blocks any text that does.
- The walk-away limit and the vendor's hidden reserve never leave the backend.
- Permission modes: Full auto, Approve each message, Manual. You can stop auto and take over at any time.
- Export: closed BUY events produce the 38-column SAP Shopping Cart template (`DD.MM.YYYY` dates); closed SELL events produce a deal summary.

## Layout

- `backend/`: FastAPI, SQLite store, deal maths in `app/deal.py`, negotiation engine in `app/negotiation/`, export in `app/export.py`. See `backend/README.md`.
- `frontend/`: Next.js app. See `frontend/README.md`.
- `assumptions.txt`: every assumption, numbered. `docs/superpowers/`: spec and plans.
- `data/samples`, `reference`: input samples and UI reference.
