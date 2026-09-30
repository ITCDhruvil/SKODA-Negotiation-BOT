"""FastAPI layer. Response models (app.schemas) are the only shape that leaves the backend."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import lifecycle, readmodel, services, simulate
from app import schemas as sch
from app.models import Dataset, Direction, Objective
from app.store import Repo


class PointsIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    target: float = Field(gt=0)
    limit: float = Field(gt=0)
    objective: Optional[Objective] = None


class ReleaseIn(BaseModel):
    vendor_ids: Optional[list[str]] = None


class SimulateIn(BaseModel):
    direction: Direction


def _range(date_from: Optional[date], date_to: Optional[date]) -> tuple[Optional[date], Optional[date]]:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to")
    return date_from, date_to


def create_app(repo: Repo, seed_dataset: Dataset) -> FastAPI:
    """seed_dataset is what /api/admin/reset restores, even after a restart."""
    app = FastAPI(title="Main Negotiation Bot API")
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, exc: RequestValidationError):
        # The default handler echoes the offending input, which cannot be JSON-encoded for
        # Infinity or NaN; report only where and why.
        detail = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                  for e in exc.errors()]
        return JSONResponse({"detail": detail}, status_code=422)

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

    @app.get("/api/health", response_model=sch.Health)
    def health():
        return sch.Health(status="ok")

    @app.get("/api/dashboard", response_model=sch.Dashboard)
    def dashboard(date_from: Optional[date] = None, date_to: Optional[date] = None):
        return readmodel.dashboard(snap(), *_range(date_from, date_to))

    @app.get("/api/events", response_model=list[sch.EventView])
    def events(q: Optional[str] = None, direction: Optional[Direction] = None,
               status: Optional[sch.EventStatus] = None, category_key: Optional[str] = None,
               date_from: Optional[date] = None, date_to: Optional[date] = None):
        s = snap().between(*_range(date_from, date_to))
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
            descriptions = {e.id: " ".join(i.description for i in s.items_by_event[e.id])
                            for e in s.events}
            out = [e for e in out if needle in " ".join(
                [e.id, e.title, e.category, e.requestor, e.source_cart_no or "",
                 descriptions[e.id]]).lower()]
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

    @app.get("/api/items", response_model=list[sch.ItemRow])
    def items(event_id: Optional[str] = None, has_bids: Optional[bool] = None,
              recommendation: Optional[sch.Recommendation] = None,
              direction: Optional[Direction] = None, q: Optional[str] = None):
        return readmodel.item_rows(snap(), event_id=event_id, has_bids=has_bids,
                                   recommendation=recommendation, direction=direction, q=q)

    @app.get("/api/history", response_model=list[sch.HistoryRow])
    def history(direction: Optional[Direction] = None, category_key: Optional[str] = None,
                q: Optional[str] = None, negotiated: Optional[bool] = None,
                limit: int = Query(500, ge=1, le=1000)):
        return readmodel.history_rows(snap(), direction=direction, category_key=category_key,
                                      q=q, negotiated=negotiated, limit=limit)

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
        kept = "objective" not in body.model_fields_set
        with repo.transaction():
            objective = (services._item(repo, item_id).objective if kept else body.objective)
            services.set_points(repo, item_id, target=body.target, limit=body.limit,
                                objective=objective)
        return detail(item_id)

    @app.post("/api/items/{item_id}/confirm-points", response_model=sch.ItemDetail)
    def confirm_points(item_id: str):
        services.confirm_points(repo, item_id)
        return detail(item_id)

    @app.post("/api/items/{item_id}/release-bids", response_model=sch.ItemDetail)
    def release_bids(item_id: str, body: Optional[ReleaseIn] = None):
        services.release_bids(repo, item_id, body.vendor_ids if body else None)
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

    @app.post("/api/admin/reset", response_model=sch.ResetResult)
    def reset():
        repo.load_dataset(seed_dataset)
        return sch.ResetResult(events=repo.count("event"))

    return app
