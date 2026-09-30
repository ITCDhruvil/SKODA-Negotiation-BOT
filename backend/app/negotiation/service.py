"""Negotiation sessions: start, advance in the chosen permission mode, approve or edit drafts,
take over by hand, accept, hand back, and close with an outcome.

Permission modes (switchable at any time):
  auto     the assistant plays a full round each time `advance` is called
  approve  it prepares each move as a draft; the buyer approves, edits or discards it
  manual   it does nothing on its own; the buyer writes every message
Every outgoing offer and message passes the guardrails in every mode.
"""
from __future__ import annotations

import math
from typing import Optional

from app import clock, deal, lifecycle
from app.models import Bid, Draft, Event, Item, Mode, Outcome, Session, Turn
from app.negotiation import guardrails, messages, tactics, vendor_sim
from app.services import Conflict, NotFound
from app.store import Repo


# --- lookups ---------------------------------------------------------------------------------

def _get(repo: Repo, kind: str, id: str, label: str):
    obj = repo.get(kind, id)
    if obj is None:
        raise NotFound(f"{label} {id} not found")
    return obj


def _item(repo: Repo, item_id: str) -> Item:
    return _get(repo, "item", item_id, "item")


def _event(repo: Repo, item: Item) -> Event:
    return _get(repo, "event", item.event_id, "event")


def _session(repo: Repo, session_id: str) -> Session:
    return _get(repo, "session", session_id, "session")


def _points(item: Item) -> tuple[float, float]:
    return (item.target if item.target is not None else item.suggested_target,
            item.limit if item.limit is not None else item.suggested_limit)


def _bid(repo: Repo, session: Session) -> Bid:
    return _get(repo, "bid", session.bid_id, "bid")


def sessions_for_item(repo: Repo, item_id: str) -> list[Session]:
    return repo.fetch("session", parent=item_id)


def turns(repo: Repo, session_id: str) -> list[Turn]:
    return sorted(repo.fetch("turn", parent=session_id), key=lambda t: t.seq)


def pending_draft(repo: Repo, session_id: str) -> Optional[Draft]:
    pending = [d for d in repo.fetch("draft", parent=session_id) if d.status == "pending"]
    return pending[-1] if pending else None


def _save_session(repo: Repo, s: Session) -> Session:
    repo.put("session", s.id, s, parent=s.item_id)
    return s


def _move_item(repo: Repo, item: Item, new_state: str) -> Item:
    lifecycle.require_transition(item.state, new_state)
    item = item.model_copy(update={"state": new_state})
    repo.put("item", item.id, item, parent=item.event_id)
    return item


def _add_turn(repo: Repo, s: Session, speaker: str, author: str, text: str,
              price: Optional[float], payment: Optional[str]) -> Turn:
    seq = len(repo.fetch("turn", parent=s.id)) + 1
    t = Turn(id=f"{s.id}-T{seq:02d}", session_id=s.id, seq=seq, speaker=speaker, author=author,
             text=text, price=price, payment_code=payment, at=clock.now())
    repo.put("turn", t.id, t, parent=s.id)
    return t


def _context(s: Session, item: Item, event: Event) -> tactics.Context:
    target, limit = _points(item)
    return tactics.Context(
        direction=event.direction, target=target, limit=limit, objective=item.objective,
        round=s.round, our_offer=s.our_offer, vendor_offer=s.vendor_offer,
        previous_vendor_offer=s.previous_vendor_offer, vendor_payment=s.vendor_payment,
        vendor_final=s.vendor_final, original_price=s.original_price)


def _our_text(kind: str, s: Session, item: Item, event: Event, vendor_name: str, price: float,
              payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None) -> str:
    return messages.our_message(
        kind, direction=event.direction, lang=s.language, vendor_name=vendor_name,
        item=item.description, qty=item.qty, unit=item.unit, quote=s.vendor_offer, price=price,
        payment_ask=payment_ask, agreed_payment=agreed_payment)


def _vendor_name(repo: Repo, s: Session) -> str:
    v = repo.get("vendor", s.vendor_id)
    return v.name if v else s.vendor_id


def _require_active(s: Session) -> None:
    if s.status != "active":
        raise Conflict(f"this negotiation is {s.status.replace('_', ' ')}")


# --- start -----------------------------------------------------------------------------------

def start(repo: Repo, item_id: str, *, vendor_id: Optional[str] = None, mode: Mode = "approve") -> Session:
    """The buyer starts a negotiation. It never starts on its own."""
    with repo.transaction():
        item = _item(repo, item_id)
        event = _event(repo, item)
        existing = sessions_for_item(repo, item_id)
        if item.state == "analyzed":
            item = _move_item(repo, item, "negotiating")
        elif item.state == "negotiating" and not any(x.status in ("active", "agreed") for x in existing):
            pass  # a seeded item that is already marked as negotiating but has no conversation yet
        else:
            raise Conflict("a negotiation can only start after the quotes are analysed")
        bids = repo.fetch("bid", parent=item_id)
        if not bids:
            raise Conflict("there are no quotes to negotiate on")
        if vendor_id is not None:
            chosen = next((b for b in bids if b.vendor_id == vendor_id), None)
            if chosen is None:
                raise Conflict(f"{vendor_id} has not quoted on this item")
        else:
            chosen = deal.best_first(event.direction, bids, key=lambda b: deal.effective_price(
                event.direction, b.unit_price, payment_code=b.payment_code, incoterm=b.incoterm,
                delivery_days=b.delivery_days, warranty_months=b.warranty_months))[0]
        s = Session(
            id=f"S-{item_id}-{len(existing) + 1}", item_id=item_id, vendor_id=chosen.vendor_id,
            bid_id=chosen.id, mode=mode, status="active", language=chosen.language, round=0,
            original_price=chosen.unit_price, original_payment=chosen.payment_code,
            our_offer=None, our_payment=None, vendor_offer=chosen.unit_price,
            previous_vendor_offer=chosen.unit_price, vendor_payment=chosen.payment_code,
            vendor_final=False, agreed_price=None, agreed_payment=None, handback_reason=None,
            started_at=clock.now(), ended_at=None)
        return _save_session(repo, s)


# --- executing moves -------------------------------------------------------------------------

def _finish(repo: Repo, s: Session, item: Item, *, agreed: bool, price: Optional[float] = None,
            payment: Optional[str] = None, reason: Optional[str] = None) -> Session:
    s = s.model_copy(update={
        "status": "agreed" if agreed else "handed_back", "agreed_price": price if agreed else None,
        "agreed_payment": payment if agreed else None, "handback_reason": reason,
        "ended_at": clock.now()})
    _move_item(repo, item, "result_pending" if agreed else "handed_back")
    for d in repo.fetch("draft", parent=s.id):
        if d.status == "pending":
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
    return _save_session(repo, s)


def _send_offer(repo: Repo, s: Session, price: float, payment: Optional[str], text: Optional[str],
                author: str) -> Session:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    target, limit = _points(item)
    price = deal.round_price(price)
    try:
        guardrails.check_offer(event.direction, price, limit)
        if payment:
            deal.payment_days(payment)
        vendor_name = _vendor_name(repo, s)
        if text is None:
            kind = "open" if s.our_offer is None else "counter"
            text = _our_text(kind, s, item, event, vendor_name, price, payment_ask=payment)
        guardrails.check_message(text, offer_price=price, limit=limit, target=target)
    except (guardrails.GuardrailError, ValueError) as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, price, payment)
    reserve = repo.get("reserve", s.bid_id)
    reply = vendor_sim.reply(
        event.direction, reserve=reserve, flex=vendor_sim.flexibility(s.bid_id),
        vendor_price=s.vendor_offer, vendor_payment=s.vendor_payment, offer_price=price,
        offer_payment=payment, round_no=s.round)
    changed_payment = reply.payment if reply.payment != s.vendor_payment else None
    _add_turn(repo, s, "vendor", "vendor", messages.vendor_message(
        reply.kind, direction=event.direction, lang=s.language, price=reply.price,
        unit=item.unit, payment=changed_payment), reply.price, reply.payment)
    s = s.model_copy(update={
        "our_offer": price, "our_payment": payment, "round": s.round + 1,
        "previous_vendor_offer": s.vendor_offer, "vendor_offer": reply.price,
        "vendor_payment": reply.payment, "vendor_final": reply.final})
    if reply.kind == "accept":
        return _finish(repo, s, item, agreed=True, price=price, payment=reply.payment)
    return _save_session(repo, s)


def _accept(repo: Repo, s: Session, text: Optional[str], author: str) -> Session:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    target, limit = _points(item)
    try:
        guardrails.check_offer(event.direction, s.vendor_offer, limit)
        if text is None:
            text = _our_text("accept", s, item, event, _vendor_name(repo, s), s.vendor_offer,
                             agreed_payment=s.vendor_payment)
        guardrails.check_message(text, offer_price=s.vendor_offer, limit=limit, target=target)
    except guardrails.GuardrailError as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, s.vendor_offer, s.vendor_payment)
    return _finish(repo, s, item, agreed=True, price=s.vendor_offer, payment=s.vendor_payment)


def _hand_back(repo: Repo, s: Session, reason: str) -> Session:
    return _finish(repo, s, _item(repo, s.item_id), agreed=False, reason=reason)


# --- drafts and modes ------------------------------------------------------------------------

def _prepare_draft(repo: Repo, s: Session) -> Draft:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    ctx = _context(s, item, event)
    decision = tactics.opening(ctx) if s.our_offer is None else tactics.respond(ctx)
    text = ""
    if decision.kind == "offer":
        text = _our_text(decision.message_kind, s, item, event, _vendor_name(repo, s),
                         decision.price, payment_ask=decision.payment)
    elif decision.kind == "accept":
        text = _our_text("accept", s, item, event, _vendor_name(repo, s), decision.price,
                         agreed_payment=decision.payment)
    n = len(repo.fetch("draft", parent=s.id)) + 1
    d = Draft(id=f"{s.id}-D{n:02d}", session_id=s.id, kind=decision.kind, price=decision.price,
              payment_code=decision.payment, text=text, rationale=decision.rationale,
              created=clock.now(), status="pending")
    repo.put("draft", d.id, d, parent=s.id)
    return d


def _execute(repo: Repo, s: Session, d: Draft, *, price: Optional[float] = None,
             payment: Optional[str] = None, text: Optional[str] = None) -> Session:
    edited = ((price is not None and price != d.price) or (text is not None and text != d.text)
              or (payment is not None and payment != d.payment_code))
    author = "human" if edited else "bot"
    repo.put("draft", d.id, d.model_copy(update={"status": "sent"}), parent=s.id)
    if d.kind == "offer":
        rewording = (price is not None and price != d.price) or (payment is not None and payment != d.payment_code)
        return _send_offer(repo, s, price if price is not None else d.price,
                           payment if payment is not None else d.payment_code,
                           text if text is not None else (None if rewording else d.text), author)
    if d.kind == "accept":
        return _accept(repo, s, text if text is not None else d.text, author)
    return _hand_back(repo, s, d.rationale)


def advance(repo: Repo, session_id: str) -> Session:
    """Do the next step the current mode allows. Safe to call repeatedly."""
    with repo.transaction():
        s = _session(repo, session_id)
        if s.status != "active" or s.mode == "manual":
            return s
        d = pending_draft(repo, s.id)
        if d is None:
            d = _prepare_draft(repo, s)
        if s.mode == "auto":
            return _execute(repo, s, d)
        return s  # approve mode: wait for the buyer


def approve_draft(repo: Repo, session_id: str, draft_id: str, *, price: Optional[float] = None,
                  payment_code: Optional[str] = None, text: Optional[str] = None) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        d = _get(repo, "draft", draft_id, "draft")
        if d.session_id != s.id or d.status != "pending":
            raise Conflict("that draft is no longer waiting for approval")
        return _execute(repo, s, d, price=price, payment=payment_code, text=text)


def discard_draft(repo: Repo, session_id: str, draft_id: str) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        d = _get(repo, "draft", draft_id, "draft")
        if d.session_id != s.id or d.status != "pending":
            raise Conflict("that draft is no longer waiting for approval")
        repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
        return s


def send_message(repo: Repo, session_id: str, *, price: float, payment_code: Optional[str] = None,
                 text: Optional[str] = None) -> Session:
    """The buyer writes the next move by hand (any mode; a pending draft is discarded)."""
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        d = pending_draft(repo, s.id)
        if d is not None:
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
        return _send_offer(repo, s, price, payment_code, text, "human")


def accept_offer(repo: Repo, session_id: str) -> Session:
    """The buyer accepts the vendor's current offer."""
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _accept(repo, s, None, "human")


def hand_back(repo: Repo, session_id: str, reason: Optional[str] = None) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _hand_back(repo, s, reason or "You took this back to decide yourself.")


def set_mode(repo: Repo, session_id: str, mode: Mode) -> Session:
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        return _save_session(repo, s.model_copy(update={"mode": mode}))


# --- result, approval and closing ------------------------------------------------------------

def _latest_session(repo: Repo, item_id: str) -> Optional[Session]:
    all_ = sessions_for_item(repo, item_id)
    return all_[-1] if all_ else None


def continue_negotiation(repo: Repo, item_id: str) -> Session:
    """From the result screen: keep negotiating the same conversation."""
    with repo.transaction():
        item = _item(repo, item_id)
        s = _latest_session(repo, item_id)
        if s is None or s.status != "agreed":
            raise Conflict("there is no agreed result to continue from")
        _move_item(repo, item, "negotiating")
        return _save_session(repo, s.model_copy(update={
            "status": "active", "agreed_price": None, "agreed_payment": None, "ended_at": None}))


def accept_deal(repo: Repo, item_id: str) -> Item:
    """The buyer accepts a negotiated result, or the best quote as it stands, for approval."""
    with repo.transaction():
        item = _item(repo, item_id)
        if item.state == "result_pending":
            s = _latest_session(repo, item_id)
            if s is None or s.status != "agreed":
                raise Conflict("there is no agreed result to accept")
        return _move_item(repo, item, "awaiting_approval")


def approve_event(repo: Repo, event_id: str) -> list[Outcome]:
    """Approve and close every item of the event that is awaiting approval, recording outcomes."""
    with repo.transaction():
        event = _get(repo, "event", event_id, "event")
        awaiting = [i for i in repo.fetch("item", parent=event_id) if i.state == "awaiting_approval"]
        if not awaiting:
            raise Conflict("nothing in this event is waiting for approval")
        made = []
        for item in awaiting:
            _, limit = _points(item)
            s = _latest_session(repo, item.id)
            bids = repo.fetch("bid", parent=item.id)
            if s is not None and s.status == "agreed":
                bid = _bid(repo, s)
                if not deal.within_limit(event.direction, s.agreed_price, limit):
                    raise Conflict("the agreed price is outside your limit and cannot be approved")
                minutes = max(1, math.ceil((s.ended_at - s.started_at).total_seconds() / 60))
                outcome = Outcome(
                    item_id=item.id, vendor_id=s.vendor_id, direction=event.direction, qty=item.qty,
                    original_price=s.original_price, final_price=s.agreed_price, negotiated=True,
                    payment_code=s.agreed_payment or s.vendor_payment, incoterm=bid.incoterm,
                    closed_date=clock.now().date(), duration_minutes=minutes)
            else:
                if not bids:
                    raise Conflict(f"{item.id} has no quotes to accept")
                best = deal.best_first(event.direction, bids, key=lambda b: b.unit_price)[0]
                outcome = Outcome(
                    item_id=item.id, vendor_id=best.vendor_id, direction=event.direction,
                    qty=item.qty, original_price=best.unit_price, final_price=best.unit_price,
                    negotiated=False, payment_code=best.payment_code, incoterm=best.incoterm,
                    closed_date=clock.now().date(), duration_minutes=0)
            repo.put("outcome", item.id, outcome, parent=item.id)
            _move_item(repo, item, "closed")
            made.append(outcome)
        return made
