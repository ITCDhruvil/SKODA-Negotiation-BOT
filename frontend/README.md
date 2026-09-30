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
# API (bash)
NEGOTIATION_CORS_ORIGINS=http://localhost:3100 python -m uvicorn app.main:app --port 8000
# web
npm run dev -- -p 3100
```

In PowerShell set the variable first:

```powershell
$env:NEGOTIATION_CORS_ORIGINS="http://localhost:3100"
python -m uvicorn app.main:app --port 8000
```

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) if the API is not at `http://localhost:8000`.

## Checks

```bash
npm run typecheck
npm run check:types    # fails when lib/api-types.ts is out of date with backend/openapi.json
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
