"""FastAPI layer. Response models (app.schemas) are the only shape that leaves the backend."""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import lifecycle, readmodel, services, simulate
from app import schemas as sch
from app.models import Dataset, Direction, Objective
from app.store import Repo


class PointsIn(BaseModel):
    target: float
    limit: float
    objective: Optional[Objective] = None


class ReleaseIn(BaseModel):
    vendor_ids: Optional[list[str]] = None


class SimulateIn(BaseModel):
    direction: Direction


def create_app(repo: Repo, seed_dataset: Optional[Dataset] = None) -> FastAPI:
    """seed_dataset is only used by /api/admin/reset; pass None to reset from the repo's own
    initial export (captured now)."""
    initial = seed_dataset or repo.dataset()
    app = FastAPI(title="Main Negotiation Bot API")
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(services.NotFound)
    async def _not_found(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(services.Conflict)
    async def _conflict(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(lifecycle.InvalidTransition)
    async def _invalid(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    def snap() -> readmodel.Snapshot:
        return readmodel.snapshot(repo)

    def detail(item_id: str) -> sch.ItemDetail:
        s = snap()
        if item_id not in s.item_by_id:
            raise services.NotFound(f"item {item_id} not found")
        return readmodel.item_detail(s, s.item_by_id[item_id])

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/dashboard", response_model=sch.Dashboard)
    def dashboard():
        return readmodel.dashboard(snap())

    @app.get("/api/events", response_model=list[sch.EventView])
    def events(q: Optional[str] = None, direction: Optional[Direction] = None,
               status: Optional[sch.EventStatus] = None, category_key: Optional[str] = None):
        s = snap()
        ivs = {i.id: readmodel.item_view(s, i) for i in s.items}
        out = [readmodel.event_view(s, e, ivs) for e in s.events]
        if direction:
            out = [e for e in out if e.direction == direction]
        if status:
            out = [e for e in out if e.status == status]
        if category_key:
            out = [e for e in out if e.category_key == category_key]
        if q:
            needle = q.lower()
            out = [e for e in out if needle in " ".join(
                [e.id, e.title, e.category, e.requestor]).lower()]
        return sorted(out, key=lambda e: (e.created, e.id), reverse=True)

    @app.post("/api/events/simulate", response_model=sch.EventDetail)
    def simulate_event(body: SimulateIn):
        event_id = simulate.simulate_event(repo, body.direction)
        s = snap()
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.get("/api/events/{event_id}", response_model=sch.EventDetail)
    def event(event_id: str):
        s = snap()
        if event_id not in s.event_by_id:
            raise services.NotFound(f"event {event_id} not found")
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.get("/api/items/{item_id}", response_model=sch.ItemDetail)
    def item(item_id: str):
        return detail(item_id)

    @app.get("/api/items/{item_id}/comparison", response_model=sch.ComparisonView)
    def item_comparison(item_id: str):
        return detail(item_id).comparison

    @app.get("/api/items/{item_id}/history", response_model=sch.HistoryView)
    def item_history(item_id: str):
        s = snap()
        if item_id not in s.item_by_id:
            raise services.NotFound(f"item {item_id} not found")
        return readmodel.history_view(s, s.item_by_id[item_id])

    @app.put("/api/items/{item_id}/points", response_model=sch.ItemDetail)
    def set_points(item_id: str, body: PointsIn):
        services.set_points(repo, item_id, target=body.target, limit=body.limit,
                            objective=body.objective)
        return detail(item_id)

    @app.post("/api/items/{item_id}/confirm-points", response_model=sch.ItemDetail)
    def confirm_points(item_id: str):
        services.confirm_points(repo, item_id)
        return detail(item_id)

    @app.post("/api/items/{item_id}/release-bids", response_model=sch.ItemDetail)
    def release_bids(item_id: str, body: ReleaseIn):
        services.release_bids(repo, item_id, body.vendor_ids)
        return detail(item_id)

    @app.post("/api/items/{item_id}/analyze", response_model=sch.ItemDetail)
    def analyze(item_id: str):
        services.analyze(repo, item_id)
        return detail(item_id)

    @app.get("/api/vendors", response_model=list[sch.VendorView])
    def vendors():
        s = snap()
        return [readmodel.vendor_view(s, v) for v in s.vendors.values()]

    @app.get("/api/vendors/{vendor_id}", response_model=sch.VendorDetail)
    def vendor(vendor_id: str):
        s = snap()
        if vendor_id not in s.vendors:
            raise services.NotFound(f"vendor {vendor_id} not found")
        return readmodel.vendor_detail(s, s.vendors[vendor_id])

    @app.post("/api/admin/reset")
    def reset():
        repo.load_dataset(initial)
        return {"events": repo.count("event")}

    return app
