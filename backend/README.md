# Negotiation bot backend

FastAPI + SQLite. The seed data is committed in `data/seed/`.

## Run

```bash
cd backend
pip install -e ".[dev]"
python -m uvicorn app.main:app --reload --port 8000
```

The first start creates `data/app.db` (git-ignored) from `data/seed/dataset.json`.
Set `NEGOTIATION_DB` to use another file. `POST /api/admin/reset` restores the committed seed (`data/seed/dataset.json`), even after a restart.
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
- Vendor reserve prices (`Dataset.reserves`) and unreleased bid prices never appear in an API response (`tests/test_api.py` changes every hidden number and checks that no response changes).
- Item states: draft, points_reviewed, awaiting_bids, bids_in, analyzed (Phase 2); negotiating and later arrive in Phase 4. Points can be edited in draft, points_reviewed, analyzed and handed_back (a handed_back item returns to analyzed and keeps its bids); confirming is only valid from draft.

## Negotiation API notes

- **Modes.** Every session has a permission mode that can change at any time: `auto` (the assistant plays a full round on each `advance`), `approve` (it prepares a draft the buyer approves, edits or discards; the first draft is ready as soon as the session starts) and `manual` (nothing happens unless the buyer sends a message). Switching to manual drops any pending draft.
- **The auto loop.** Auto mode is a client loop: call `POST /api/sessions/{id}/advance` repeatedly. Stop when the session status leaves `active` (agreed or handed back), when the buyer switches the session to manual, or on any 409, for example a guardrail failure. `advance` is idempotent in approve mode and does nothing in manual mode.
- **Manual messages are priced offers.** Every message the buyer sends carries a price; there are no text-only questions yet. The price must be inside the limit and strictly better than the vendor's current price, and any number in the text must belong to the offer.
- **After a hand-back.** To negotiate again, set the points again with `PUT /api/items/{id}/points` even if they are unchanged (that returns the item to `analyzed`), then start a new session. An item can instead be closed with `POST /api/items/{id}/close-without-deal`, which records no outcome.
- **Restarts.** A restarted session starts again from the vendor's original quote; earlier concessions are not remembered.
