"""Open a negotiation from a case that lives in the AIS prototype (the Negotiation Bot module, steps NB 1-8).

The AIS case is the real record. Its supplier offers and the Buyer's minimum and maximum targets arrive here, are turned
into an event with one item (the cart, as one lot priced as the cart total) and one bid per supplier, and the negotiation
with the chosen supplier starts. Calling this again for the same case only adds a conversation for a supplier that has
none yet. Everything is demo data: the supplier's walk-away price is made up from its id, so a run is repeatable.
"""
from __future__ import annotations

import zlib
from datetime import timedelta
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app import clock, deal, policy
from app.models import Bid, Event, Item, Session, Vendor
from app.negotiation import service as neg
from app.services import Conflict
from app.store import Repo


class Supplier(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sid: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    lang: Literal["en", "hi", "mr"] = "en"
    total: float = Field(gt=0, le=100_000_000)  # the supplier's offer for the whole cart
    rating: float = Field(default=4.0, ge=0, le=5)
    payment_code: str = "ZD30"


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


class HandoffOut(BaseModel):
    event_id: str
    item_id: str
    session_id: str


def _reserve(total: float, target: float, sid: str) -> float:
    """The supplier's hidden floor: it can come down 55% to 110% of the way from its offer to the Buyer's target."""
    share = 0.55 + (zlib.crc32(f"reserve:{sid}".encode("utf-8")) % 56) / 100
    return deal.round_price(max(1.0, total - max(0.0, total - target) * share))


def open_case(repo: Repo, body: HandoffIn) -> HandoffOut:
    chosen = next((s for s in body.suppliers if s.sid == body.supplier_id), None)
    if chosen is None:
        raise Conflict("the supplier to negotiate with is not among the offers")
    if not deal.points_valid("buy", body.target, body.limit):
        raise Conflict("the Buyer's minimum must not be above the maximum")
    event_id = body.case_no
    item_id = f"{event_id}-01"
    with repo.transaction():
        if repo.get("event", event_id) is None:
            today = clock.today()
            first = body.suppliers[0]
            repo.put("event", event_id, Event(
                id=event_id, type="shopping_cart", direction="buy", title=body.topic, company_id=body.entity,
                company="SKODA Auto VW India", plant="Plant Pune", purch_org="LPOS (SAVWIPL)", purch_group="A05",
                category="Shopping cart negotiation", category_key="negbot", requestor=body.requestor,
                cost_centre=body.cost_centre, created=today, approval_date=today, due=today + timedelta(days=14),
                source_cart_no=body.cart_no, hero=False, acceptable=False, no_deal=False, stage="analyzed",
                origin="AIS"))
            repo.put("item", item_id, Item(
                id=item_id, event_id=event_id, position=1, description=body.topic, kind="goods", qty=1.0, unit="LOT",
                reference_price=first.total, suggested_target=body.target, suggested_limit=body.limit,
                target=body.target, limit=body.limit, incoterm="FH", delivery_days=14, state="analyzed"), parent=event_id)
            for k, sup in enumerate(body.suppliers, start=1):
                repo.put("vendor", sup.sid, Vendor(
                    id=sup.sid, name=sup.name, sap_no=sup.sid, type="supplier", categories=[], rating=sup.rating,
                    payment_pref=sup.payment_code, past_deals=0))
                bid = Bid(id=f"{item_id}-B{k}", item_id=item_id, vendor_id=sup.sid, unit_price=sup.total,
                          payment_code=sup.payment_code, incoterm="FH", delivery_days=14, validity_days=30,
                          warranty_months=0, language=sup.lang)
                repo.put("bid", bid.id, bid, parent=item_id)
                repo.put("reserve", bid.id, _reserve(sup.total, body.target, sup.sid))
        existing = [s for s in neg.sessions_for_item(repo, item_id) if s.vendor_id == chosen.sid]
        if existing:
            return HandoffOut(event_id=event_id, item_id=item_id, session_id=existing[-1].id)
        item = repo.get("item", item_id)
        band = policy.band(deal.value(item.qty, item.reference_price))
        mode = policy.default_mode(band) if band != "management" else "approve"
        s: Session = neg.start(repo, item_id, vendor_id=chosen.sid, mode=mode)  # type: ignore[arg-type]
        return HandoffOut(event_id=event_id, item_id=item_id, session_id=s.id)
