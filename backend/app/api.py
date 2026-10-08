"""FastAPI layer. Response models (app.schemas) are the only shape that leaves the backend."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app import contract, deal, event_delete, export, handoff, lifecycle, new_event, readmodel, services, simulate
from app import schemas as sch
from app.models import Dataset, Direction, Language, Mode, Objective
from app.negotiation import service as neg
from app.negotiation import views as negviews
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


class StartIn(BaseModel):
    vendor_id: Optional[str] = None
    mode: Mode = "approve"
    hold_active: bool = False  # put the running negotiations on hold first


class ChooseIn(BaseModel):
    session_id: str


class QuestionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1000)


class LanguageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Language


class ModeIn(BaseModel):
    mode: Mode


class ApproveDraftIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    price: Optional[float] = Field(default=None, gt=0)
    payment_code: Optional[str] = Field(default=None, max_length=8)
    text: Optional[str] = Field(default=None, max_length=2000)


class MessageIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    price: float = Field(gt=0)
    payment_code: Optional[str] = Field(default=None, max_length=8)
    text: Optional[str] = Field(default=None, max_length=2000)


class HandBackIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


def _range(date_from: Optional[date], date_to: Optional[date]) -> tuple[Optional[date], Optional[date]]:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to")
    return date_from, date_to


DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8765", "http://127.0.0.1:8765"]  # the Desk, and the AIS prototype served locally


def create_app(repo: Repo, seed_dataset: Dataset,
               cors_origins: Optional[list[str]] = None) -> FastAPI:
    """seed_dataset is what /api/admin/reset restores, even after a restart."""
    app = FastAPI(title="Main Negotiation Bot API")
    app.add_middleware(
        CORSMiddleware, allow_origins=cors_origins or DEFAULT_ORIGINS,
        # Anyone running the AIS prototype from their own machine, on whatever port their static server uses.
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
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
        view = readmodel.item_detail(s, s.item_by_id[item_id])
        sessions = neg.sessions_for_item(repo, item_id)
        tried = {x.vendor_id for x in sessions}
        item = s.item_by_id[item_id]
        limit = item.limit if item.limit is not None else item.suggested_limit
        direction = s.event_by_id[item.event_id].direction
        by_vendor = {b.vendor_id: b for b in s.bids_by_item.get(item_id, [])}
        nexts = []
        for row in view.comparison.rows:  # already best first, by effective price
            if row.vendor_id in tried or row.vendor_id not in by_vendor:
                continue
            nexts.append(sch.NextVendor(
                vendor_id=row.vendor_id, vendor_name=row.vendor_name, unit_price=row.unit_price,
                effective_price=row.effective_price, payment_code=row.payment_code, rating=row.vendor_rating,
                within_limit=deal.within_limit(direction, row.unit_price, limit),
                toughness=next(i.toughness for i in view.invitees if i.vendor_id == row.vendor_id)))
        return view.model_copy(update={
            "active_session_id": next((x.id for x in sessions if x.status == "active"), None),
            "latest_session_status": sessions[-1].status if sessions else None,
            "next_vendors": nexts})

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

    @app.get("/api/event-options")
    def event_options():
        return new_event.options(repo)

    @app.get("/api/vendor-suggestions")
    def vendor_suggestions(direction: Direction, category_key: str, q: list[str] = Query(default=[]),
                           category_label: Optional[str] = None):
        return new_event.suggest_vendors(repo, direction, category_key, q, category_label)

    @app.post("/api/events", response_model=sch.EventDetail)
    def add_event(body: new_event.NewEvent):
        event_id = new_event.create_event(repo, body)
        s = snap()
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.post("/api/handoff", response_model=handoff.HandoffOut)
    def open_ais_case(body: handoff.HandoffIn):
        """Open (or reopen) the negotiation for a case that lives in the AIS prototype."""
        return handoff.open_case(repo, body)

    @app.post("/api/handoff/{case_no}/documents", response_model=handoff.DocMeta)
    def ais_case_document(case_no: str, body: handoff.DocIn):
        """A file of an AIS case (offer, SFO, comparison sheet). The same name for the same supplier replaces the earlier one."""
        return handoff.add_document(repo, case_no, body)

    @app.get("/api/events/{event_id}/ais", response_model=handoff.AisInfoOut)
    def ais_event_info(event_id: str):
        """What AIS sent with the case: its details and its files."""
        return handoff.ais_info(repo, event_id)

    @app.get("/api/documents/{doc_id}/download", response_class=Response)
    def ais_document_download(doc_id: str):
        d, raw = handoff.download(repo, doc_id)
        safe = d.name.replace('"', "").replace("\\", "")
        return Response(raw, media_type=d.mime, headers={"Content-Disposition": f'inline; filename="{safe}"'})

    @app.get("/api/handoff/{case_no}/result", response_model=handoff.HandoffResult)
    def ais_case_result(case_no: str):
        """Where the negotiation of an AIS case stands, with the negotiated unit price per supplier and position."""
        return handoff.case_result(repo, case_no)

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
              direction: Optional[Direction] = None, q: Optional[str] = None,
              date_from: Optional[date] = None, date_to: Optional[date] = None):
        s = snap().between(*_range(date_from, date_to))
        return readmodel.item_rows(s, event_id=event_id, has_bids=has_bids,
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

    @app.get("/api/history/{record_id}", response_model=sch.HistoryDeal)
    def history_deal(record_id: str):
        return readmodel.history_deal(snap(), record_id)

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

    # --- negotiation sessions ----------------------------------------------------------------

    @app.get("/api/items/{item_id}/sessions", response_model=list[sch.SessionSummary])
    def item_sessions(item_id: str):
        detail(item_id)  # 404 for an unknown item
        return negviews.summaries_for_item(repo, item_id)

    @app.get("/api/negotiations", response_model=list[sch.SessionRow])
    def all_negotiations():
        return negviews.all_rows(repo)

    @app.get("/api/events/{event_id}/sessions", response_model=list[sch.SessionSummary])
    def event_sessions(event_id: str):
        return negviews.summaries_for_event(repo, event_id)

    @app.post("/api/items/{item_id}/negotiations", response_model=sch.SessionView)
    def start_negotiation(item_id: str, body: StartIn):
        s = neg.start(repo, item_id, vendor_id=body.vendor_id, mode=body.mode, hold_active=body.hold_active)
        return negviews.session_view(repo, s.id)

    @app.get("/api/sessions/{session_id}", response_model=sch.SessionView)
    def get_session(session_id: str):
        return negviews.session_view(repo, session_id)

    @app.put("/api/sessions/{session_id}/mode", response_model=sch.SessionView)
    def set_mode(session_id: str, body: ModeIn):
        neg.set_mode(repo, session_id, body.mode)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/questions", response_model=sch.SessionView)
    def ask_question(session_id: str, body: QuestionIn):
        neg.ask_question(repo, session_id, body.text)
        return negviews.session_view(repo, session_id)

    @app.put("/api/sessions/{session_id}/language", response_model=sch.SessionView)
    def set_language(session_id: str, body: LanguageIn):
        neg.set_language(repo, session_id, body.language)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/advance", response_model=sch.SessionView)
    def advance(session_id: str):
        neg.advance(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/drafts/{draft_id}/approve", response_model=sch.SessionView)
    def approve_draft(session_id: str, draft_id: str, body: Optional[ApproveDraftIn] = None):
        b = body or ApproveDraftIn()
        neg.approve_draft(repo, session_id, draft_id, price=b.price, payment_code=b.payment_code,
                          text=b.text)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/drafts/{draft_id}/discard", response_model=sch.SessionView)
    def discard_draft(session_id: str, draft_id: str):
        neg.discard_draft(repo, session_id, draft_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/messages", response_model=sch.SessionView)
    def send_message(session_id: str, body: MessageIn):
        neg.send_message(repo, session_id, price=body.price, payment_code=body.payment_code,
                         text=body.text)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/accept-offer", response_model=sch.SessionView)
    def accept_offer(session_id: str):
        neg.accept_offer(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/hand-back", response_model=sch.SessionView)
    def hand_back(session_id: str, body: Optional[HandBackIn] = None):
        neg.hand_back(repo, session_id, (body.reason if body else None))
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/hold", response_model=sch.SessionView)
    def hold_negotiation(session_id: str):
        neg.hold(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/sessions/{session_id}/resume", response_model=sch.SessionView)
    def resume_negotiation(session_id: str):
        neg.resume(repo, session_id)
        return negviews.session_view(repo, session_id)

    @app.post("/api/items/{item_id}/continue", response_model=sch.SessionView)
    def continue_negotiation(item_id: str):
        s = neg.continue_negotiation(repo, item_id)
        return negviews.session_view(repo, s.id)

    @app.post("/api/items/{item_id}/choose", response_model=sch.SessionView)
    def choose_vendor(item_id: str, body: ChooseIn):
        s = neg.choose_deal(repo, item_id, body.session_id)
        return negviews.session_view(repo, s.id)

    @app.post("/api/items/{item_id}/accept-deal", response_model=sch.ItemDetail)
    def accept_deal(item_id: str):
        neg.accept_deal(repo, item_id)
        return detail(item_id)

    @app.post("/api/items/{item_id}/close-without-deal", response_model=sch.ItemDetail)
    def close_without_deal(item_id: str):
        neg.close_without_deal(repo, item_id)
        return detail(item_id)

    @app.post("/api/events/{event_id}/approve", response_model=sch.EventDetail)
    def approve_event(event_id: str):
        neg.approve_event(repo, event_id)
        s = snap()
        return readmodel.event_detail(s, s.event_by_id[event_id])

    @app.delete("/api/events/{event_id}")
    def delete_event(event_id: str):
        """Remove an event and everything under it (items, quotes, conversations, outcomes, files from AIS)."""
        return {"deleted": event_id, **event_delete.delete_event(repo, event_id)}

    @app.get("/api/events/{event_id}/contract", response_model=list[sch.ContractDoc])
    def event_contract(event_id: str):
        """The sample contract document(s) for the closed deals of an event, one per supplier."""
        return contract.contract_docs(snap(), event_id)

    @app.get("/api/events/{event_id}/export", response_class=Response,
             responses={200: {"content": {"text/csv": {}}}})
    def export_event(event_id: str):
        name, text = export.export_event(snap(), event_id)
        return Response(text.encode("utf-8"), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    return app
