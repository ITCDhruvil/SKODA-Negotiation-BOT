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

from app import clock, deal, lifecycle, policy
from app.models import Bid, Draft, Event, Item, Mode, Outcome, Session, Turn
from app.negotiation import guardrails, info, insights, messages, personas, tactics, vendor_sim, vendor_talk
from app.services import Conflict, NotFound
from app.store import Repo

TOKEN_SHARE = 0.005  # a price move of this share of the vendor's price or less (or a rupee) is a token step


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
              price: Optional[float], payment: Optional[str], tactic: Optional[str] = None,
              delay: int = 0) -> Turn:
    before = repo.fetch("turn", parent=s.id)
    seq = len(before) + 1
    elapsed = (max(t.elapsed_minutes for t in before) if before else 0) + (delay if before else 0)
    t = Turn(id=f"{s.id}-T{seq:02d}", session_id=s.id, seq=seq, speaker=speaker, author=author,
             text=text, price=price, payment_code=payment, at=clock.now(), tactic=tactic,
             delay_minutes=delay if before else 0, elapsed_minutes=elapsed)
    repo.put("turn", t.id, t, parent=s.id)
    return t


def _alternative(repo: Repo, s: Session, event: Event) -> tuple[bool, str]:
    """Whether another vendor has really quoted on this item, and the best of those quotes as text."""
    others = [b for b in repo.fetch("bid", parent=s.item_id) if b.vendor_id != s.vendor_id]
    if not others:
        return False, ""
    best = deal.best_first(event.direction, sorted(others, key=lambda b: b.id), key=lambda b: b.unit_price)[0]
    return True, f"{vendor_name(repo, best.vendor_id)} at {messages.money(best.unit_price)}"


def _context(repo: Repo, s: Session, item: Item, event: Event) -> tactics.Context:
    target, limit = _points(item)
    has_alt, alt = _alternative(repo, s, event)
    return tactics.Context(
        direction=event.direction, target=target, limit=limit, objective=item.objective,
        round=s.round, our_offer=s.our_offer, vendor_offer=s.vendor_offer,
        previous_vendor_offer=s.previous_vendor_offer, vendor_payment=s.vendor_payment,
        vendor_final=s.vendor_final, original_price=s.original_price, continuing=s.continuing,
        stalls=s.stall_count, bluff_called=s.bluff_called, trade_used=s.trade_used,
        leverage_used=s.leverage_used, split_used=s.split_used, token_count=s.token_count,
        crawl_called=s.crawl_called, has_alternative=has_alt, alternative=alt)


def _facts(repo: Repo, s: Session, item: Item, event: Event) -> info.Facts:
    bid = _bid(repo, s)
    return info.Facts(
        direction=event.direction, lang=s.language, qty=item.qty,
        unit_word=messages._qty_unit(s.language, item.unit, item.qty),
        item_delivery_days=item.delivery_days, bid_delivery_days=bid.delivery_days, incoterm=bid.incoterm,
        payment_code=s.vendor_payment, validity_days=bid.validity_days, warranty_months=bid.warranty_months)


def _our_text(repo: Repo, kind: str, s: Session, item: Item, event: Event, vendor_name: str, price: float,
              payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None) -> str:
    answers = ask = None
    if kind in ("counter", "close"):
        facts = _facts(repo, s, item, event)
        if s.vendor_question:
            answers = [info.our_answer(t, facts) for t in s.vendor_question.split(",")]
        topic = info.ours_question_topic(event.direction, s.round)
        if topic and (topic, event.direction) in info._ASK_OURS:
            ask = info.ask_ours(topic, facts)
    return messages.our_message(
        kind, direction=event.direction, lang=s.language, vendor_name=vendor_name,
        item=item.description, qty=item.qty, unit=item.unit, quote=s.vendor_offer, price=price,
        payment_ask=payment_ask, agreed_payment=agreed_payment, variant=s.round, answers=answers, ask=ask)


def vendor_name(repo: Repo, vendor_id: str) -> str:
    v = repo.get("vendor", vendor_id)
    return v.name if v else vendor_id


def _vendor_name(repo: Repo, s: Session) -> str:
    return vendor_name(repo, s.vendor_id)


def _require_handling(item: Item, mode: Mode) -> None:
    """The deal's size decides who may negotiate it (see app.policy)."""
    band = policy.band(deal.value(item.qty, item.reference_price))
    if band == "management":
        raise Conflict(policy.message(band))
    if mode == "auto" and not policy.allows_auto(band):
        raise Conflict("Above ten lakh rupees a person stays in the loop, so the bot cannot send messages on its own. "
                       "Choose approve each message, or write them yourself.")


def _require_active(s: Session) -> None:
    if s.status != "active":
        raise Conflict(f"this negotiation is {s.status.replace('_', ' ')}")


def _require_negotiating(item: Item) -> None:
    if item.state != "negotiating":
        raise Conflict(f"this item is {item.state.replace('_', ' ')}, not being negotiated")


def _blank_to_none(text: Optional[str]) -> Optional[str]:
    """Empty or whitespace-only text means "word it for me"."""
    return text if text is not None and text.strip() else None


def _check_text(repo: Repo, s: Session, item: Item, text: str, *, price: float,
                payment: Optional[str], limit: float, target: float) -> None:
    """Run the message guardrails with the numbers this conversation allows the text to name."""
    name = _vendor_name(repo, s)
    allowed = [item.qty, price, s.original_price, s.vendor_offer, s.previous_vendor_offer,
               deal.payment_days(s.vendor_payment), deal.payment_days(s.original_payment)]
    allowed += info.numbers(_facts(repo, s, item, _event(repo, item)))  # days, months and quantity we may quote
    if payment:
        allowed.append(deal.payment_days(payment))
    # Digits that belong to the item's or the vendor's name (such as "M10" or "3M") are not offers.
    allowed += guardrails.numbers_in(item.description) + guardrails.numbers_in(name)
    guardrails.check_message(
        text, offer_price=price, limit=limit, target=target, allowed_numbers=allowed,
        mask=(name, messages.short_name(name), item.description))


# --- start -----------------------------------------------------------------------------------

def start(repo: Repo, item_id: str, *, vendor_id: Optional[str] = None, mode: Mode = "approve") -> Session:
    """The buyer starts a negotiation. It never starts on its own."""
    with repo.transaction():
        item = _item(repo, item_id)
        event = _event(repo, item)
        _require_handling(item, mode)
        existing = sessions_for_item(repo, item_id)
        if item.state == "handed_back":
            # The last vendor did not agree. The buyer may try the next one with the same points.
            item = _move_item(repo, item, "analyzed")
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
            # The best quote is the best raw unit price (what the item view shows); ties go to the
            # lower bid id.
            chosen = deal.best_first(event.direction, sorted(bids, key=lambda b: b.id),
                                     key=lambda b: b.unit_price)[0]
        s = Session(
            id=f"S-{item_id}-{len(existing) + 1}", item_id=item_id, vendor_id=chosen.vendor_id,
            bid_id=chosen.id, mode=mode, status="active", language=chosen.language, round=0,
            original_price=chosen.unit_price, original_payment=chosen.payment_code,
            our_offer=None, our_payment=None, vendor_offer=chosen.unit_price,
            previous_vendor_offer=chosen.unit_price, vendor_payment=chosen.payment_code,
            vendor_final=False, continuing=False, agreed_price=None, agreed_payment=None, handback_reason=None,
            started_at=clock.now(), ended_at=None)
        _save_session(repo, s)
        if mode == "approve":
            _prepare_draft(repo, s)  # so the buyer sees the first move without asking for it
        return s


# --- executing moves -------------------------------------------------------------------------

def _finish(repo: Repo, s: Session, item: Item, *, agreed: bool, price: Optional[float] = None,
            payment: Optional[str] = None, reason: Optional[str] = None, vendor_ended: bool = False) -> Session:
    s = s.model_copy(update={
        "status": "agreed" if agreed else "handed_back", "agreed_price": price if agreed else None,
        "agreed_payment": payment if agreed else None, "handback_reason": reason,
        "vendor_ended": vendor_ended, "ended_at": clock.now()})
    _move_item(repo, item, "result_pending" if agreed else "handed_back")
    for d in repo.fetch("draft", parent=s.id):
        if d.status == "pending":
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
    return _save_session(repo, s)


def _send_offer(repo: Repo, s: Session, price: float, payment: Optional[str], text: Optional[str],
                author: str, tactic: Optional[str] = None) -> Session:
    item = _item(repo, s.item_id)
    _require_negotiating(item)
    event = _event(repo, item)
    target, limit = _points(item)
    price = deal.round_price(price)
    text = _blank_to_none(text)
    try:
        guardrails.check_offer(event.direction, price, limit)
        if not deal.is_better(event.direction, price, s.vendor_offer):
            raise Conflict(f"The vendor already offered {messages.money(s.vendor_offer)}; "
                           "accept it instead.")
        if payment:
            deal.payment_days(payment)
        if text is None:
            kind = "open" if s.our_offer is None else "counter"
            text = _our_text(repo, kind, s, item, event, _vendor_name(repo, s), price, payment_ask=payment)
        _check_text(repo, s, item, text, price=price, payment=payment, limit=limit, target=target)
    except (guardrails.GuardrailError, ValueError) as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, price, payment, tactic or ("manual" if author == "human" else None),
              delay=vendor_talk.our_delay(s.bid_id, s.round))
    reserve = repo.get("reserve", s.bid_id)
    reply = vendor_sim.reply(
        event.direction, reserve=reserve, flex=vendor_sim.flexibility(s.bid_id),
        vendor_price=s.vendor_offer, vendor_payment=s.vendor_payment, offer_price=price,
        offer_payment=payment, round_no=s.round, persona=personas.persona_for(s.bid_id, s.vendor_id),
        tactic=tactic or "", mood=s.mood, our_prev=s.our_offer, ultimatum_round=s.ultimatum_round,
        scripted=s.bid_id in personas.SCRIPTED_BIDS, seed=s.bid_id)
    changed_payment = reply.payment if reply.payment != s.vendor_payment else None
    facts = _facts(repo, s, item, event)
    asked = info.topics_in(text, include_payment=author == "human")
    answer = " ".join(info.vendor_answer(t, facts) for t in asked) or None
    question = None
    if reply.kind == "counter" and s.round == 1 and not s.vendor_question:
        question = info.ask_vendor(facts)  # the vendor wants to know a few things before it moves
    if vendor_talk.pauses_before(s.round, reply.kind, s.bid_id):
        # Before moving, the vendor says it will check with someone: a short message of its own.
        _add_turn(repo, s, "vendor", "vendor", vendor_talk.pause(s.language, s.round), None, None,
                  delay=vendor_talk.pause_delay(s.bid_id, s.round))
    gap = abs(s.vendor_offer - price) / s.vendor_offer if (s.vendor_offer and s.round >= 1) else None  # nothing to react to at first
    vendor_turn = _add_turn(repo, s, "vendor", "vendor", messages.vendor_message(
        reply.kind, direction=event.direction, lang=s.language, price=reply.price,
        unit=item.unit, payment=changed_payment, variant=s.round, answer=answer, ask=question, gap=gap,
        flavour=reply.flavour),
        reply.price, reply.payment,
        delay=(vendor_talk.walk_away_delay(s.bid_id, s.round) if reply.ends else
               vendor_talk.reply_delay(personas.persona_for(s.bid_id, s.vendor_id), s.bid_id, s.round,
                                       vendor_talk.pauses_before(s.round, reply.kind, s.bid_id))))
    # Movement means a lower (buy) or higher (sell) price, or a better payment term; the very first reply does not count.
    # A token step (a rupee or so) is not movement: it counts as a stall and is tracked on its own.
    step = abs(reply.price - s.vendor_offer)
    token = (s.bid_id not in personas.SCRIPTED_BIDS and 0 < step <= max(1.0 if s.vendor_offer >= 100 else 0.0, TOKEN_SHARE * s.vendor_offer)
             and reply.payment == s.vendor_payment)
    moved = (step > 0 and not token) or reply.payment != s.vendor_payment
    stalls = s.stall_count + 1 if (not moved and s.round >= 1 and reply.kind != "accept") else 0
    tokens = (s.token_count + 1 if token else (0 if moved else s.token_count)) if s.round >= 1 else 0
    s = s.model_copy(update={
        "stall_count": stalls,
        "bluff_called": s.bluff_called or tactic == "bluff",
        "trade_used": s.trade_used or tactic == "trade",
        "leverage_used": s.leverage_used or tactic == "leverage",
        "split_used": s.split_used or tactic == "split",
        "crawl_called": s.crawl_called or tactic == "crawl", "token_count": tokens,
        "mood": reply.mood,
        "ultimatum_round": s.round if (reply.flavour == "ultimatum" and s.ultimatum_round < 0) else s.ultimatum_round,
        "vendor_question": info.VENDOR_QUESTION_TOPICS if question else None,
        "our_offer": price, "our_payment": payment, "round": s.round + 1,
        "previous_vendor_offer": s.vendor_offer, "vendor_offer": reply.price,
        "vendor_payment": reply.payment, "vendor_final": reply.final, "continuing": False})
    notes = _notes(repo, s, item, event, reply)
    if notes:
        repo.put("turn", vendor_turn.id, vendor_turn.model_copy(update={"insights": notes}), parent=s.id)
    if reply.kind == "accept":
        return _finish(repo, s, item, agreed=True, price=price, payment=reply.payment)
    if reply.ends:
        _, alt = _alternative(repo, s, event)
        nxt = f"switch to the next-best quote ({alt}), " if alt else ""
        reason = (f"The vendor ended the conversation at {messages.money(reply.price)}, "
                  f"after your offer of {messages.money(price)}. Options: {nxt}trade payment terms with a different vendor, "
                  "adjust your limit yourself, or close without a deal.")
        return _finish(repo, s, item, agreed=False, reason=reason, vendor_ended=True)
    return _save_session(repo, s)


def _notes(repo: Repo, s: Session, item: Item, event: Event, reply: vendor_sim.VendorReply) -> list:
    """The private note for this round, from the session after the vendor's reply."""
    from app import readmodel  # imported here: the read model imports this package too

    target, limit = _points(item)
    tough = readmodel.vendor_toughness(repo.fetch("history"), s.vendor_id)
    others = [(vendor_name(repo, b.vendor_id), b) for b in sorted(repo.fetch("bid", parent=s.item_id), key=lambda b: b.id)
              if b.vendor_id != s.vendor_id]
    earlier = [i.kind for t in turns(repo, s.id) for i in t.insights]
    return insights.pick(insights.Round(
        direction=event.direction, vendor_name=vendor_name(repo, s.vendor_id), qty=item.qty,
        original_price=s.original_price, original_payment=s.original_payment, price=s.vendor_offer,
        previous_price=s.previous_vendor_offer, payment=s.vendor_payment, round_no=s.round, stalls=s.stall_count,
        tokens=s.token_count, mood=s.mood, flavour=reply.flavour, kind=reply.kind, ended=reply.ends,
        final=reply.final, target=target, limit=limit, own_bid=_bid(repo, s), others=others,
        toughness_pct=tough.average_concession_pct, toughness_deals=tough.negotiated_deals,
        recent=tuple(earlier[-2:])))


def _accept(repo: Repo, s: Session, text: Optional[str], author: str) -> Session:
    item = _item(repo, s.item_id)
    _require_negotiating(item)
    event = _event(repo, item)
    target, limit = _points(item)
    text = _blank_to_none(text)
    try:
        guardrails.check_offer(event.direction, s.vendor_offer, limit)
        if text is None:
            text = _our_text(repo, "accept", s, item, event, _vendor_name(repo, s), s.vendor_offer,
                             agreed_payment=s.vendor_payment)
        _check_text(repo, s, item, text, price=s.vendor_offer, payment=s.vendor_payment,
                    limit=limit, target=target)
    except guardrails.GuardrailError as e:
        raise Conflict(str(e)) from e
    _add_turn(repo, s, "us", author, text, s.vendor_offer, s.vendor_payment, delay=vendor_talk.our_delay(s.bid_id, s.round))
    return _finish(repo, s, item, agreed=True, price=s.vendor_offer, payment=s.vendor_payment)


def _hand_back(repo: Repo, s: Session, reason: str) -> Session:
    return _finish(repo, s, _item(repo, s.item_id), agreed=False, reason=reason)


# --- drafts and modes ------------------------------------------------------------------------

def _prepare_draft(repo: Repo, s: Session) -> Draft:
    item = _item(repo, s.item_id)
    event = _event(repo, item)
    ctx = _context(repo, s, item, event)
    decision = tactics.opening(ctx) if s.our_offer is None else tactics.respond(ctx)
    text = ""
    if decision.kind == "offer":
        text = _our_text(repo, decision.message_kind, s, item, event, _vendor_name(repo, s),
                         decision.price, payment_ask=decision.payment)
    elif decision.kind == "accept":
        text = _our_text(repo, "accept", s, item, event, _vendor_name(repo, s), decision.price,
                         agreed_payment=decision.payment)
    n = len(repo.fetch("draft", parent=s.id)) + 1
    d = Draft(id=f"{s.id}-D{n:02d}", session_id=s.id, kind=decision.kind, price=decision.price,
              payment_code=decision.payment, text=text, rationale=decision.rationale,
              tactic=decision.tactic or None, created=clock.now(), status="pending")
    repo.put("draft", d.id, d, parent=s.id)
    return d


def _execute(repo: Repo, s: Session, d: Draft, *, price: Optional[float] = None,
             payment: Optional[str] = None, text: Optional[str] = None) -> Session:
    text = _blank_to_none(text)
    if d.kind != "offer" and (price is not None or payment is not None or text is not None):
        raise Conflict("That kind of draft cannot be edited.")
    edited = ((price is not None and price != d.price) or (text is not None and text != d.text)
              or (payment is not None and payment != d.payment_code))
    author = "human" if edited else "bot"
    repo.put("draft", d.id, d.model_copy(update={"status": "sent"}), parent=s.id)
    if d.kind == "offer":
        rewording = (price is not None and price != d.price) or (payment is not None and payment != d.payment_code)
        return _send_offer(repo, s, price if price is not None else d.price,
                           payment if payment is not None else d.payment_code,
                           text if text is not None else (None if rewording else d.text), author,
                           None if edited and rewording else d.tactic)
    if d.kind == "accept":
        return _accept(repo, s, d.text, author)
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
        _require_active(s)
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


def ask_question(repo: Repo, session_id: str, text: str) -> Session:
    """The buyer asks the vendor something (delivery, payment, warranty...). No offer, no new round."""
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        item = _item(repo, s.item_id)
        _require_negotiating(item)
        event = _event(repo, item)
        text = _blank_to_none(text)
        if text is None:
            raise Conflict("Write the question first.")
        target, limit = _points(item)
        name = _vendor_name(repo, s)
        allowed = [item.qty, s.original_price, s.vendor_offer, s.previous_vendor_offer,
                   deal.payment_days(s.vendor_payment), deal.payment_days(s.original_payment)]
        allowed += info.numbers(_facts(repo, s, item, event))
        allowed += guardrails.numbers_in(item.description) + guardrails.numbers_in(name)
        try:
            guardrails.check_message(text, offer_price=None, limit=limit, target=target,
                                     allowed_numbers=allowed, mask=(name, messages.short_name(name), item.description))
        except guardrails.GuardrailError as e:
            raise Conflict(str(e)) from e
        facts = _facts(repo, s, item, event)
        _add_turn(repo, s, "us", "human", text, None, None, delay=vendor_talk.our_delay(s.bid_id, s.round))
        _add_turn(repo, s, "vendor", "vendor", info.vendor_answers(text, facts), None, None,
                  delay=vendor_talk.reply_delay("cooperative", s.bid_id, s.round + 100, False))
        return s


def set_language(repo: Repo, session_id: str, language: str) -> Session:
    """Switch the language of the messages that follow; what was already said stays as it was."""
    if language not in messages.LANGS:
        raise Conflict(f"unsupported language: {language}")
    with repo.transaction():
        s = _session(repo, session_id)
        _require_active(s)
        d = pending_draft(repo, s.id)
        if d is not None:
            repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
        s = _save_session(repo, s.model_copy(update={"language": language}))
        if s.mode == "approve":
            _prepare_draft(repo, s)  # the waiting draft is rewritten in the new language
        return s


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
        _require_handling(_item(repo, s.item_id), mode)
        if mode == "manual":
            d = pending_draft(repo, s.id)
            if d is not None:
                repo.put("draft", d.id, d.model_copy(update={"status": "discarded"}), parent=s.id)
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
            "status": "active", "agreed_price": None, "agreed_payment": None, "ended_at": None,
            "continuing": True}))


def accept_deal(repo: Repo, item_id: str) -> Item:
    """The buyer accepts a negotiated result, or the best quote as it stands, for approval."""
    with repo.transaction():
        item = _item(repo, item_id)
        if item.state == "result_pending":
            s = _latest_session(repo, item_id)
            if s is None or s.status != "agreed":
                raise Conflict("there is no agreed result to accept")
        return _move_item(repo, item, "awaiting_approval")


def close_without_deal(repo: Repo, item_id: str) -> Item:
    """The buyer gives up on an item that was handed back: it closes with no outcome."""
    with repo.transaction():
        item = _item(repo, item_id)
        if item.state != "handed_back":
            raise Conflict("only an item that was handed back can be closed without a deal")
        return _move_item(repo, item, "closed")


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
                    closed_date=clock.today(), duration_minutes=minutes,
                    tenure_months=bid.tenure_months or item.tenure_months)
            else:
                if not bids:
                    raise Conflict(f"{item.id} has no quotes to accept")
                best = deal.best_first(event.direction, bids, key=lambda b: b.unit_price)[0]
                outcome = Outcome(
                    item_id=item.id, vendor_id=best.vendor_id, direction=event.direction,
                    qty=item.qty, original_price=best.unit_price, final_price=best.unit_price,
                    negotiated=False, payment_code=best.payment_code, incoterm=best.incoterm,
                    closed_date=clock.today(), duration_minutes=0,
                    tenure_months=best.tenure_months or item.tenure_months)
            repo.put("outcome", item.id, outcome, parent=item.id)
            _move_item(repo, item, "closed")
            made.append(outcome)
        return made
