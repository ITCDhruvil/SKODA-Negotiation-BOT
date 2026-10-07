"""Session views for the API. The vendor's reserve and flexibility are never part of these."""
from __future__ import annotations

from typing import Optional

from app import deal
from app import schemas as sch
from app.models import Draft, Session, Turn
from app.negotiation import service, tactics, vendor_sim
from app.negotiation.messages import money
from app.services import NotFound
from app.store import Repo


def summary(repo: Repo, s: Session) -> sch.SessionSummary:
    return sch.SessionSummary(
        id=s.id, item_id=s.item_id, vendor_id=s.vendor_id, vendor_name=service.vendor_name(repo, s.vendor_id),
        mode=s.mode, status=s.status, round=s.round, started_at=s.started_at,
        agreed_price=s.agreed_price)


def _turn(t: Turn) -> sch.TurnView:
    return sch.TurnView(seq=t.seq, speaker=t.speaker, author=t.author, text=t.text, price=t.price,
                        payment_code=t.payment_code, at=t.at, tactic=t.tactic,
                        delay_minutes=t.delay_minutes, elapsed_minutes=t.elapsed_minutes,
                        insights=[sch.InsightView(kind=i.kind, tone=i.tone, text=i.text) for i in t.insights])


def _draft(d: Draft) -> sch.DraftView:
    return sch.DraftView(id=d.id, kind=d.kind, price=d.price, payment_code=d.payment_code,
                         text=d.text, rationale=d.rationale, tactic=d.tactic, created=d.created)


def _recommendation(s: Session, draft: Optional[Draft]) -> str:
    if draft is not None:
        return draft.rationale
    if s.status == "agreed":
        return (f"The vendor agreed at {money(s.agreed_price)}. Review the result, then accept it "
                "or keep negotiating.")
    if s.status == "handed_back":
        return s.handback_reason or "This negotiation was handed back to you."
    if s.status == "on_hold":
        return "On hold. Nothing is sent. Resume it when you want to carry on from here."
    if s.mode == "manual":
        return "You are writing the messages. Nothing is sent unless you send it."
    if s.mode == "auto":
        return "Running automatically. You can stop and take over at any time."
    return "Ready to prepare the next move for your approval."


def _phase(s: Session) -> str:
    if s.status not in ("active", "on_hold"):
        return "done"
    r = s.round
    return "opening" if r < 1 else "probing" if r < 3 else "trading" if r < 6 else "pressing" if r < 9 else "closing"


def _stance(s: Session) -> tuple[str, str]:
    """What the vendor has shown so far (observed behaviour only)."""
    if s.round < 2:
        return "unknown", "Too early to tell: the vendor has only replied once."
    if s.token_count >= 2:
        return "crawling", f"Crawling: the vendor has moved by token amounts in its last {s.token_count} replies."
    moved = abs(s.vendor_offer - s.original_price) / s.original_price
    terms = s.vendor_payment != s.original_payment
    if s.stall_count >= 2:
        return "firm", f"Firm: the vendor has not moved in its last {s.stall_count} replies."
    if terms and moved < 0.01:
        return "open_on_terms", "Open on terms: the price has barely moved, but the vendor has eased its payment terms."
    if moved / max(s.round, 1) < 0.004:
        return "firm", "Firm: the price has moved very little over several rounds."
    return "open", "Open: the vendor keeps moving toward us."


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
        recommendation=_recommendation(s, draft))
    base = summary(repo, s).model_dump()
    active = s.status == "active"
    awaiting_result = s.status == "agreed" and item.state == "result_pending"
    others_running = any(x.status == "active" for x in service.sessions_for_item(repo, s.item_id) if x.id != s.id)
    actions = sch.SessionActions(
        can_advance=active and s.mode != "manual", can_send=active,
        can_accept_offer=active and inside, can_hand_back=active,
        can_continue=awaiting_result, can_accept_deal=awaiting_result,
        can_hold=active, can_resume=s.status == "on_hold" and not others_running)
    return sch.SessionView(
        **base, event_id=item.event_id, actions=actions, item_description=item.description, direction=d, language=s.language, unit=item.unit,
        qty=item.qty, original_price=s.original_price, our_offer=s.our_offer,
        vendor_offer=s.vendor_offer, vendor_payment=s.vendor_payment, vendor_final=s.vendor_final,
        agreed_payment=s.agreed_payment,
        agreed_delta=(deal.realised_delta(d, s.original_price, s.agreed_price, item.qty)
                      if s.agreed_price is not None else None),
        original_value=deal.value(item.qty, s.original_price),
        agreed_value=deal.value(item.qty, s.agreed_price) if s.agreed_price is not None else None,
        handback_reason=s.handback_reason, vendor_ended=s.vendor_ended, ended_at=s.ended_at,
        turns=[_turn(t) for t in service.turns(repo, s.id)],
        pending_draft=_draft(draft) if draft else None, intelligence=intelligence,
        strategy=_strategy(repo, s, item, event), policy=_policy(item),
        from_ais=event.origin == "AIS")


def _policy(item):
    from app import readmodel

    return readmodel.policy_view(item)


def summaries_for_event(repo: Repo, event_id: str) -> list[sch.SessionSummary]:
    if repo.get("event", event_id) is None:
        raise NotFound(f"event {event_id} not found")
    out: list[sch.SessionSummary] = []
    for item in sorted(repo.fetch("item", parent=event_id), key=lambda i: i.position):
        out.extend(summaries_for_item(repo, item.id))
    return out


def _strategy(repo: Repo, s: Session, item, event) -> sch.Strategy:
    from app import readmodel

    stance, note = _stance(s)
    others = [b for b in repo.fetch("bid", parent=item.id) if b.vendor_id != s.vendor_id]
    alt = None
    if others:
        best = deal.best_first(event.direction, sorted(others, key=lambda b: b.id), key=lambda b: b.unit_price)[0]
        alt = f"{service.vendor_name(repo, best.vendor_id)} at {money(best.unit_price)}"
    all_turns = service.turns(repo, s.id)
    used = [t.tactic for t in all_turns if t.speaker == "us" and t.tactic]
    return sch.Strategy(
        round=s.round, max_rounds=tactics.MAX_ROUNDS, phase=_phase(s), stance=stance, stance_note=note,
        mood=s.mood, mood_label=vendor_sim.mood_label(s.mood),
        tactics_used=used, elapsed_minutes=all_turns[-1].elapsed_minutes if all_turns else 0, alternative=alt, history=readmodel.vendor_toughness(repo.fetch("history"), s.vendor_id))


def summaries_for_item(repo: Repo, item_id: str) -> list[sch.SessionSummary]:
    return [summary(repo, s) for s in service.sessions_for_item(repo, item_id)]


def all_rows(repo: Repo) -> list[sch.SessionRow]:
    """Every negotiation, newest first."""
    rows = []
    for s in repo.fetch("session"):
        item = repo.get("item", s.item_id)
        event = repo.get("event", item.event_id)
        rows.append(sch.SessionRow(
            **summary(repo, s).model_dump(), event_id=event.id, event_title=event.title,
            item_description=item.description, direction=event.direction, qty=item.qty, unit=item.unit,
            original_price=s.original_price, vendor_offer=s.vendor_offer, ended_at=s.ended_at))
    return sorted(rows, key=lambda r: r.started_at, reverse=True)
