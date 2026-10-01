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

Open **Demo story** in the sidebar for a guided, nine-step walk through the whole process, with a purchase story, a scrap story and a hard-vendor story (a vendor whose history says it is hard to crack: about 17 messages, a tested "final price", a terms trade, and the agreement at 275). Each step explains what happens and why it matters, shows the live data on the right, and has one button that does the step for real: restart, set the goals, collect vendor responses, analyse the quotes, start the negotiation (it then plays out as a live chat that a person can stop and take over), accept the result, approve and close, then download the SAP Shopping Cart template (or the scrap deal summary) and see the savings on the dashboard. The steps follow the real state of the item, so reloading the page resumes where you were, and any finished step can be revisited with Back and Next.

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

- The vendor is simulated by rules, not a model. It has a hidden reserve and a persona, and it can push back: it says an offer is too far away, claims nothing is left to give, names a final price, offers a smaller lot, sets a deadline, or (for the harder personas) leaves. A vendor that moves by a rupee or so a round is treated as stalling. Research behind this is in `docs/research/vendor-negotiation-behaviour.md`.

## From this POC to a real negotiation bot

No model needs training. Keep the decisions in code and use a hosted model through an API only for language.

1. **Keep the engine.** Targets, limits, accept or hand-back rules and any "a human must handle deals above a set value" rule stay deterministic. A model never decides a price.
2. **Add a language layer.** The code decides what to say (counter at a price, ask for terms, hold). A model words it in the right language and tone. A model also reads the vendor's free-text reply into structured data: new price, payment change, question, refusal, deadline.
3. **Reading the vendor is the main new work.** Today the vendor reply is simulated; a real one is free text, so a misreading is the biggest risk.
4. **Keep the guardrails.** Run every generated message through the same checks (no numbers outside the limit, no mention of software). If a message fails, send the template wording instead.
5. **Make the channel real.** Email or WhatsApp Business, one thread per vendor and item, real delays, reminders and "no reply" handling.
6. **Test on history, not by training.** Replay anonymised past threads and compare the bot's decisions with what buyers did. Roll out in stages: drafts for review, then approve each message, then automatic for small deals only.

## Layout

- `backend/`: FastAPI, SQLite store, deal maths in `app/deal.py`, negotiation engine in `app/negotiation/`, export in `app/export.py`. See `backend/README.md`.
- `frontend/`: Next.js app. See `frontend/README.md`.
- `assumptions.txt`: every assumption, numbered. `docs/superpowers/`: spec and plans.
- `data/samples`, `reference`: input samples and UI reference.
