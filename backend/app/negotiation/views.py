"""Session views for the API. The vendor's reserve and flexibility are never part of these."""
from __future__ import annotations

from typing import Optional

from app import deal
from app import schemas as sch
from app.models import Draft, Session, Turn
from app.negotiation import service
from app.negotiation.messages import money
from app.services import NotFound
from app.store import Repo


def _vendor_name(repo: Repo, vendor_id: str) -> str:
    v = repo.get("vendor", vendor_id)
    return v.name if v else vendor_id


def summary(repo: Repo, s: Session) -> sch.SessionSummary:
    return sch.SessionSummary(
        id=s.id, item_id=s.item_id, vendor_id=s.vendor_id, vendor_name=_vendor_name(repo, s.vendor_id),
        mode=s.mode, status=s.status, round=s.round, started_at=s.started_at,
        agreed_price=s.agreed_price)


def _turn(t: Turn) -> sch.TurnView:
    return sch.TurnView(seq=t.seq, speaker=t.speaker, author=t.author, text=t.text, price=t.price,
                        payment_code=t.payment_code, at=t.at)


def _draft(d: Draft) -> sch.DraftView:
    return sch.DraftView(id=d.id, kind=d.kind, price=d.price, payment_code=d.payment_code,
                         text=d.text, rationale=d.rationale, created=d.created)


def _recommendation(s: Session, draft: Optional[Draft], limit_word: str) -> str:
    if draft is not None:
        return draft.rationale
    if s.status == "agreed":
        return (f"The vendor agreed at {money(s.agreed_price)}. Review the result, then accept it "
                "or keep negotiating.")
    if s.status == "handed_back":
        return s.handback_reason or "This negotiation was handed back to you."
    if s.mode == "manual":
        return "You are writing the messages. Nothing is sent unless you send it."
    if s.mode == "auto":
        return "Running automatically. You can stop and take over at any time."
    return "Ready to prepare the next move for your approval."


def session_view(repo: Repo, session_id: str) -> sch.SessionView:
    s = repo.get("session", session_id)
    if s is None:
        raise NotFound(f"session {session_id} not found")
    item = repo.get("item", s.item_id)
    event = repo.get("event", item.event_id)
    d = event.direction
    target = item.target if item.target is not None else item.suggested_target
    limit = item.limit if item.limit is not None else item.suggested_limit
    draft = service.pending_draft(repo, s.id)
    inside = deal.within_limit(d, s.vendor_offer, limit)
    intelligence = sch.Intelligence(
        current_bid=s.original_price, target=target, limit=limit, latest_vendor_offer=s.vendor_offer,
        our_offer=s.our_offer,
        movement=round(deal.realised_delta(d, s.original_price, s.vendor_offer, 1), 2),
        potential_delta=deal.potential_delta(d, s.vendor_offer, target, item.qty),
        delta_if_accepted=(deal.realised_delta(d, s.original_price, s.vendor_offer, item.qty)
                           if inside else None),
        within_limit=inside,
        recommendation=_recommendation(s, draft, "ceiling" if d == "buy" else "floor"))
    base = summary(repo, s).model_dump()
    return sch.SessionView(
        **base, item_description=item.description, direction=d, language=s.language, unit=item.unit,
        qty=item.qty, original_price=s.original_price, our_offer=s.our_offer,
        vendor_offer=s.vendor_offer, vendor_payment=s.vendor_payment, vendor_final=s.vendor_final,
        agreed_payment=s.agreed_payment,
        agreed_delta=(deal.realised_delta(d, s.original_price, s.agreed_price, item.qty)
                      if s.agreed_price is not None else None),
        handback_reason=s.handback_reason, ended_at=s.ended_at,
        turns=[_turn(t) for t in service.turns(repo, s.id)],
        pending_draft=_draft(draft) if draft else None, intelligence=intelligence)


def summaries_for_item(repo: Repo, item_id: str) -> list[sch.SessionSummary]:
    return [summary(repo, s) for s in service.sessions_for_item(repo, item_id)]
