"""Open a negotiation from a case that lives in the AIS prototype (the Negotiation Bot module, steps NB 1-8).

The AIS case is the real record. Its supplier offers and the Buyer's minimum and maximum targets arrive here, are turned
into an event with one item (the cart, as one lot priced as the cart total) and one bid per supplier, and the negotiation
with the chosen supplier starts. Calling this again for the same case only adds a conversation for a supplier that has
none yet. Everything is demo data: the supplier's walk-away price is made up from its id, so a run is repeatable.
"""
from __future__ import annotations

import base64
import binascii
import zlib
from datetime import datetime, timedelta
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app import clock, deal, policy
from app.models import AisDoc, AisInfo, Bid, Event, Item, Session, Vendor
from app.negotiation import service as neg
from app.services import Conflict, NotFound
from app.store import Repo


class Supplier(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sid: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    lang: Literal["en", "hi", "mr"] = "en"
    total: float = Field(gt=0, le=100_000_000)  # the supplier's offer for the whole cart
    rating: float = Field(default=4.0, ge=0, le=5)
    payment_code: str = "ZD30"


class Line(BaseModel):
    """One cart position."""
    model_config = ConfigDict(extra="forbid")
    position: int = Field(ge=1, le=999)
    description: str = Field(min_length=1, max_length=160)
    qty: float = Field(gt=0, le=100_000_000)
    unit: Literal["EA", "AU", "KG", "TON", "LOT"] = "EA"


class LineOffer(BaseModel):
    """One supplier's unit price for one cart position."""
    model_config = ConfigDict(extra="forbid")
    sid: str = Field(min_length=1, max_length=40)
    position: int = Field(ge=1, le=999)
    unit_price: float = Field(gt=0, le=100_000_000)


class Detail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=60)
    value: str = Field(max_length=300)


class HandoffIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_no: str = Field(min_length=3, max_length=40)
    supplier_id: str  # the supplier to negotiate with first
    topic: str = Field(min_length=2, max_length=160)
    suppliers: list[Supplier] = Field(min_length=1, max_length=20)
    target: float = Field(gt=0)  # the Buyer's minimum: the price to aim for
    limit: float = Field(gt=0)  # the Buyer's maximum: never pay more
    entity: str = "E1"
    cart_no: Optional[str] = None
    requestor: str = "Buyer"
    cost_centre: str = "—"
    # Optional detail. Without it the cart is one lot priced as each supplier's total (the original behaviour).
    # With it, every position becomes an item and every supplier's unit prices are its bids; `total` is then ignored.
    items: list[Line] = Field(default_factory=list, max_length=200)
    offers: list[LineOffer] = Field(default_factory=list, max_length=4000)
    details: list[Detail] = Field(default_factory=list, max_length=40)  # what AIS knows about the request, for display


class HandoffSession(BaseModel):
    position: int
    item_id: str
    session_id: str


class HandoffOut(BaseModel):
    event_id: str
    item_id: str  # the first item
    session_id: str  # the first conversation
    sessions: list[HandoffSession]


def _reserve(total: float, target: float, sid: str) -> float:
    """The supplier's hidden floor: it can come down 55% to 110% of the way from its offer to the Buyer's target."""
    share = 0.55 + (zlib.crc32(f"reserve:{sid}".encode("utf-8")) % 56) / 100
    return deal.round_price(max(1.0, total - max(0.0, total - target) * share))


def _check_detail(body: HandoffIn) -> dict[tuple[str, int], float]:
    """With positions given, every supplier must price every position exactly once."""
    positions = [ln.position for ln in body.items]
    if len(set(positions)) != len(positions):
        raise Conflict("a cart position appears twice")
    sids = {s.sid for s in body.suppliers}
    price: dict[tuple[str, int], float] = {}
    for o in body.offers:
        if o.sid not in sids:
            raise Conflict(f"an offer comes from {o.sid}, who is not among the suppliers")
        if o.position not in positions:
            raise Conflict(f"an offer is for position {o.position}, which is not in the cart")
        if (o.sid, o.position) in price:
            raise Conflict(f"{o.sid} priced position {o.position} twice")
        price[(o.sid, o.position)] = o.unit_price
    missing = [(sid, pos) for sid in sorted(sids) for pos in positions if (sid, pos) not in price]
    if missing:
        raise Conflict(f"{missing[0][0]} has no price for position {missing[0][1]}")
    return price


def _supplier_total(body: HandoffIn, price: dict[tuple[str, int], float], sup: Supplier) -> float:
    if not body.items:
        return sup.total
    return sum(ln.qty * price[(sup.sid, ln.position)] for ln in body.items)


def open_case(repo: Repo, body: HandoffIn) -> HandoffOut:
    chosen = next((s for s in body.suppliers if s.sid == body.supplier_id), None)
    if chosen is None:
        raise Conflict("the supplier to negotiate with is not among the offers")
    if not deal.points_valid("buy", body.target, body.limit):
        raise Conflict("the Buyer's minimum must not be above the maximum")
    if body.offers and not body.items:
        raise Conflict("offers need the cart positions they price")
    if body.items and not body.offers:
        raise Conflict("the cart positions need the suppliers' unit prices")
    price = _check_detail(body) if body.items else {}
    chosen_total = _supplier_total(body, price, chosen)
    case_band = policy.band(chosen_total)
    if case_band == "management":
        raise Conflict(policy.message(case_band))
    event_id = body.case_no
    lines = body.items or [Line(position=1, description=body.topic, qty=1.0, unit="LOT")]
    item_ids = {ln.position: f"{event_id}-{ln.position:02d}" for ln in lines}
    with repo.transaction():
        if repo.get("event", event_id) is None:
            today = clock.today()
            repo.put("event", event_id, Event(
                id=event_id, type="shopping_cart", direction="buy", title=body.topic, company_id=body.entity,
                company="SKODA Auto VW India", plant="Plant Pune", purch_org="LPOS (SAVWIPL)", purch_group="A05",
                category="Shopping cart negotiation", category_key="negbot", requestor=body.requestor,
                cost_centre=body.cost_centre, created=today, approval_date=today, due=today + timedelta(days=14),
                source_cart_no=body.cart_no, hero=False, acceptable=False, no_deal=False, stage="analyzed",
                origin="AIS"))
            for sup in body.suppliers:
                if repo.get("vendor", sup.sid) is not None:
                    continue  # a vendor the Desk already knows keeps its own record (name, rating, history)
                repo.put("vendor", sup.sid, Vendor(
                    id=sup.sid, name=sup.name, sap_no=sup.sid, type="supplier", categories=[], rating=sup.rating,
                    payment_pref=sup.payment_code, past_deals=0))
            # The Buyer's points are for the whole cart; each item gets the same share of them as of the chosen offer.
            t_share, l_share = body.target / chosen_total, body.limit / chosen_total
            for ln in lines:
                item_id = item_ids[ln.position]
                unit_of = (lambda sup: price[(sup.sid, ln.position)]) if body.items else (lambda sup: sup.total)
                ref = unit_of(chosen)
                repo.put("item", item_id, Item(
                    id=item_id, event_id=event_id, position=ln.position, description=ln.description, kind="goods",
                    qty=ln.qty, unit=ln.unit, reference_price=unit_of(body.suppliers[0]),
                    suggested_target=deal.round_price(ref * t_share), suggested_limit=deal.round_price(ref * l_share),
                    target=deal.round_price(ref * t_share), limit=deal.round_price(ref * l_share),
                    incoterm="FH", delivery_days=14, state="analyzed"), parent=event_id)
                for k, sup in enumerate(body.suppliers, start=1):
                    unit = unit_of(sup)
                    bid = Bid(id=f"{item_id}-B{k}", item_id=item_id, vendor_id=sup.sid, unit_price=unit,
                              payment_code=sup.payment_code, incoterm="FH", delivery_days=14, validity_days=30,
                              warranty_months=0, language=sup.lang)
                    repo.put("bid", bid.id, bid, parent=item_id)
                    repo.put("reserve", bid.id, _reserve(unit, unit * t_share, sup.sid))
        if body.details:
            repo.put("ais_info", event_id, AisInfo(event_id=event_id, details=[d.model_dump() for d in body.details]), parent=event_id)
        mode = policy.default_mode(case_band)
        started: list[HandoffSession] = []
        for ln in lines:
            item_id = item_ids[ln.position]
            existing = [x for x in neg.sessions_for_item(repo, item_id) if x.vendor_id == chosen.sid]
            if existing:
                started.append(HandoffSession(position=ln.position, item_id=item_id, session_id=existing[-1].id))
                continue
            s: Session = neg.start(repo, item_id, vendor_id=chosen.sid, mode=mode)  # type: ignore[arg-type]
            started.append(HandoffSession(position=ln.position, item_id=item_id, session_id=s.id))
        first = started[0]
        return HandoffOut(event_id=event_id, item_id=first.item_id, session_id=first.session_id, sessions=started)


# --- the result, read by AIS ----------------------------------------------------------------------

class ResultOffer(BaseModel):
    sid: str
    name: str
    initial_unit_price: float
    negotiated_unit_price: Optional[float]  # set once that supplier agreed a price for this position


class ResultItem(BaseModel):
    position: int
    item_id: str
    description: str
    qty: float
    unit: str
    session_id: Optional[str]
    session_status: Optional[str]  # active, agreed or handed_back (the latest conversation)
    round: int
    handback_reason: Optional[str]
    offers: list[ResultOffer]


class ResultSupplier(BaseModel):
    sid: str
    name: str
    initial_total: float
    negotiated_total: Optional[float]  # only when the supplier agreed every position


class ResultMessage(BaseModel):
    position: int
    seq: int
    speaker: Literal["us", "vendor"]
    text: str
    price: Optional[float]
    at: datetime


class HandoffResult(BaseModel):
    case_no: str
    status: Literal["not_started", "in_negotiation", "agreed", "partly_agreed", "failed"]
    rounds: int
    items: list[ResultItem]
    suppliers: list[ResultSupplier]
    recommended_supplier: Optional[str]  # the lowest negotiated total among suppliers that agreed everything
    handback_reason: Optional[str]
    messages: list[ResultMessage] = []  # the conversation, for the evidence pack in AIS


def case_result(repo: Repo, case_no: str) -> HandoffResult:
    event = repo.get("event", case_no)
    if event is None or getattr(event, "origin", None) != "AIS":
        raise NotFound(f"case {case_no} was never opened here")
    items = sorted(repo.fetch("item", parent=case_no), key=lambda i: i.position)
    rows: list[ResultItem] = []
    agreed: dict[tuple[str, str], float] = {}  # (item id, vendor id) -> agreed unit price
    for it in items:
        sessions = sorted(neg.sessions_for_item(repo, it.id), key=lambda x: x.started_at)
        latest = sessions[-1] if sessions else None
        for sx in sessions:
            if sx.status == "agreed" and sx.agreed_price is not None:
                agreed[(it.id, sx.vendor_id)] = sx.agreed_price
        offers = []
        for b in sorted(repo.fetch("bid", parent=it.id), key=lambda b: b.id):
            v = repo.get("vendor", b.vendor_id)
            offers.append(ResultOffer(sid=b.vendor_id, name=v.name if v else b.vendor_id, initial_unit_price=b.unit_price,
                                      negotiated_unit_price=agreed.get((it.id, b.vendor_id))))
        rows.append(ResultItem(
            position=it.position, item_id=it.id, description=it.description, qty=it.qty, unit=it.unit,
            session_id=latest.id if latest else None, session_status=latest.status if latest else None,
            round=latest.round if latest else 0, handback_reason=latest.handback_reason if latest else None,
            offers=offers))
    suppliers: list[ResultSupplier] = []
    for sid in sorted({o.sid for r in rows for o in r.offers}):
        mine = [(r, next(o for o in r.offers if o.sid == sid)) for r in rows]
        initial = sum(r.qty * o.initial_unit_price for r, o in mine)
        full = all(o.negotiated_unit_price is not None for _, o in mine)
        suppliers.append(ResultSupplier(
            sid=sid, name=mine[0][1].name, initial_total=round(initial, 2),
            negotiated_total=round(sum(r.qty * o.negotiated_unit_price for r, o in mine), 2) if full else None))
    done = [s for s in suppliers if s.negotiated_total is not None]
    recommended = min(done, key=lambda s: s.negotiated_total).sid if done else None
    statuses = [r.session_status for r in rows]
    if not any(statuses):
        status = "not_started"
    elif "active" in statuses or "on_hold" in statuses:
        status = "in_negotiation"
    elif recommended is not None:
        status = "agreed"
    elif "agreed" in statuses:
        status = "partly_agreed"
    else:
        status = "failed"
    reasons = [r.handback_reason for r in rows if r.handback_reason]
    messages = [ResultMessage(position=it.position, seq=t.seq, speaker=t.speaker, text=t.text, price=t.price, at=t.at)
                for it in items for sx in sorted(neg.sessions_for_item(repo, it.id), key=lambda x: x.started_at)
                for t in neg.turns(repo, sx.id)]
    return HandoffResult(messages=messages, case_no=case_no, status=status, rounds=max((r.round for r in rows), default=0), items=rows,
                         suppliers=suppliers, recommended_supplier=recommended, handback_reason=reasons[0] if reasons else None)


# --- files and details that come with the case ---------------------------------------------------

MAX_FILE_BYTES = 6_000_000


class DocIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["offer", "sfo", "comparison", "other"] = "other"
    supplier_id: Optional[str] = Field(default=None, max_length=40)
    mime: str = Field(default="application/octet-stream", max_length=100)
    content_b64: str = Field(min_length=1, max_length=9_000_000)
    generated: bool = False


class DocMeta(BaseModel):
    id: str
    name: str
    kind: str
    supplier_id: Optional[str]
    supplier_name: Optional[str]
    mime: str
    size: int
    uploaded_at: datetime
    generated: bool


class AisInfoOut(BaseModel):
    details: list[dict[str, str]]
    documents: list[DocMeta]


def _meta(d: AisDoc) -> DocMeta:
    return DocMeta(id=d.id, name=d.name, kind=d.kind, supplier_id=d.supplier_id, supplier_name=d.supplier_name,
                   mime=d.mime, size=d.size, uploaded_at=d.uploaded_at, generated=d.generated)


def add_document(repo: Repo, case_no: str, body: DocIn) -> DocMeta:
    """Attach a file to an AIS case. The same name for the same supplier replaces the earlier copy."""
    event = repo.get("event", case_no)
    if event is None or getattr(event, "origin", None) != "AIS":
        raise NotFound(f"case {case_no} was never opened here")
    try:
        raw = base64.b64decode(body.content_b64, validate=True)
    except (binascii.Error, ValueError):
        raise Conflict("the file content is not valid base64")
    if not raw or len(raw) > MAX_FILE_BYTES:
        raise Conflict("a file must be between 1 byte and 6 MB")
    name = None
    if body.supplier_id:
        v = repo.get("vendor", body.supplier_id)
        name = v.name if v else None
    key = zlib.crc32(f"{body.kind}|{body.supplier_id}|{body.name}".encode("utf-8"))
    doc = AisDoc(id=f"{case_no}-D{key:08x}", event_id=case_no, name=body.name, kind=body.kind,
                 supplier_id=body.supplier_id, supplier_name=name, mime=body.mime, size=len(raw),
                 uploaded_at=clock.now(), generated=body.generated, content_b64=body.content_b64)
    with repo.transaction():
        repo.put("ais_doc", doc.id, doc, parent=case_no)
    return _meta(doc)


def ais_info(repo: Repo, event_id: str) -> AisInfoOut:
    info = repo.get("ais_info", event_id)
    docs = sorted(repo.fetch("ais_doc", parent=event_id), key=lambda d: (d.kind, d.supplier_id or "", d.name))
    return AisInfoOut(details=info.details if info else [], documents=[_meta(d) for d in docs])


def download(repo: Repo, doc_id: str) -> tuple[AisDoc, bytes]:
    d = repo.get("ais_doc", doc_id)
    if d is None:
        raise NotFound("file not found")
    return d, base64.b64decode(d.content_b64)
