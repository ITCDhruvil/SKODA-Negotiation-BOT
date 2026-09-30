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
