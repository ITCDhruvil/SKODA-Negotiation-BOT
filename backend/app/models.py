"""Domain models.

Dataset.reserves holds each simulated vendor's hidden walk-away price per bid. It is
simulator-only and must never be returned by an API; Bid deliberately has no reserve field.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app import deal

Direction = Literal["buy", "sell"]
Unit = Literal["EA", "AU", "KG", "TON", "LOT"]
Language = Literal["en", "hi", "mr"]
Objective = Literal["reduce_price", "improve_lead_time", "improve_payment_terms",
                    "improve_commercial_terms"]
EventStage = Literal["draft", "awaiting_bids", "analyzed", "negotiating", "closed", "handed_back"]
ItemState = Literal[
    "draft", "points_reviewed", "awaiting_bids", "bids_in", "analyzed", "negotiating",
    "result_pending", "awaiting_approval", "closed", "handed_back",
]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Vendor(_Model):
    id: str
    name: str
    sap_no: str
    type: Literal["supplier", "scrap_buyer"]
    categories: list[str]
    rating: float
    payment_pref: str
    past_deals: int


class Event(_Model):
    id: str
    type: Literal["shopping_cart", "scrap_sale"]
    direction: Direction
    title: str
    company_id: str
    company: str
    plant: str
    purch_org: str
    purch_group: str
    category: str
    category_key: str
    requestor: str
    cost_centre: str
    created: date
    approval_date: date
    due: date
    source_cart_no: Optional[str]
    hero: bool
    acceptable: bool
    no_deal: bool
    # Seed-time stage used to lay out demo data. Live event status is derived from item states
    # (received / in_progress / closed) and must not be read from `stage` by the API.
    stage: EventStage
    origin: Optional[str] = None  # "AIS" for an event opened from a case in the AIS prototype


class Item(_Model):
    id: str
    event_id: str
    position: int
    description: str
    kind: Literal["service", "goods", "scrap"]
    qty: float
    unit: Unit
    reference_price: float
    suggested_target: float
    suggested_limit: float
    target: Optional[float]
    limit: Optional[float]
    incoterm: str
    delivery_days: int
    state: ItemState
    objective: Optional[Objective] = None
    tenure_months: Optional[int] = None  # the contract term asked for (services); None where a term does not apply


class Bid(_Model):
    id: str
    item_id: str
    vendor_id: str
    unit_price: float
    payment_code: str
    incoterm: str
    delivery_days: int
    validity_days: int
    warranty_months: int
    penalty_clause: str = ""
    language: Language = "en"
    tenure_months: Optional[int] = None  # the contract term this vendor offers (services)


class Outcome(_Model):
    item_id: str
    vendor_id: str
    direction: Direction
    qty: float
    original_price: float
    final_price: float
    negotiated: bool
    payment_code: str
    incoterm: str
    closed_date: date
    duration_minutes: int
    tenure_months: Optional[int] = None  # the agreed contract term (services)


class HistoryRecord(_Model):
    id: str
    description: str
    category_key: str
    direction: Direction
    vendor_id: str
    unit_price: float
    qty: float
    unit: Unit
    closed_date: date
    negotiated: bool
    original_price: Optional[float]


class Dataset(_Model):
    vendors: list[Vendor]
    events: list[Event]
    items: list[Item]
    bids: list[Bid]
    scripted_bids: list[Bid]
    outcomes: list[Outcome]
    history: list[HistoryRecord]
    # Simulator-only: hidden vendor walk-away price keyed by bid id (bids and scripted_bids).
    # Must never be returned by an API.
    reserves: dict[str, float]

    def event_items(self, event_id: str) -> list[Item]:
        return [i for i in self.items if i.event_id == event_id]

    def item_bids(self, item_id: str, scripted: bool = False) -> list[Bid]:
        source = self.scripted_bids if scripted else self.bids
        return [b for b in source if b.item_id == item_id]

    def event_value(self, event_id: str) -> float:
        return deal.reference_value((i.qty, i.reference_price) for i in self.event_items(event_id))


# --- negotiation ---------------------------------------------------------------------------

Mode = Literal["auto", "approve", "manual"]
SessionStatus = Literal["active", "agreed", "handed_back"]
DraftKind = Literal["offer", "accept", "handback"]


class Session(_Model):
    """One negotiation with one vendor on one item."""

    id: str
    item_id: str
    vendor_id: str
    bid_id: str
    mode: Mode
    status: SessionStatus
    language: Language
    round: int  # vendor replies received so far
    original_price: float  # the vendor's own quote when the session started
    original_payment: str
    our_offer: Optional[float]
    our_payment: Optional[str]
    vendor_offer: float
    previous_vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    continuing: bool = False  # the buyer asked to keep going after the vendor had agreed
    vendor_question: Optional[str] = None  # topics the vendor asked about that our next message answers
    stall_count: int = 0  # replies in a row (after the first) in which the vendor did not move its price
    bluff_called: bool = False
    trade_used: bool = False
    leverage_used: bool = False
    split_used: bool = False
    mood: int = 0  # how irritated the vendor is (0 calm .. 100), from how far and how stingily we offer
    token_count: int = 0  # replies in a row where the vendor moved its price by a token amount
    crawl_called: bool = False
    ultimatum_round: int = -1  # the reply in which the vendor said "take it or leave it" (-1: not yet)
    vendor_ended: bool = False  # the vendor walked away, not us
    agreed_price: Optional[float]
    agreed_payment: Optional[str]
    handback_reason: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]


class Insight(_Model):
    """A private note for the buyer, stored with a vendor's reply. It is never sent to the vendor."""

    kind: str  # position | terms | alternative | history | crawl | mood | checkpoint | left
    tone: Literal["info", "good", "warn"]
    text: str


class Turn(_Model):
    id: str
    session_id: str
    seq: int
    speaker: Literal["us", "vendor"]
    author: Literal["bot", "human", "vendor"]  # internal audit only; never shown to the vendor
    text: str
    price: Optional[float]
    payment_code: Optional[str]
    at: datetime
    tactic: Optional[str] = None  # what our message was doing (buyer-only label)
    delay_minutes: int = 0  # conversation time since the previous message
    elapsed_minutes: int = 0  # conversation time since the first message
    insights: list[Insight] = Field(default_factory=list)  # buyer-only notes about this reply


class Draft(_Model):
    """A move prepared for the buyer to approve, edit or discard."""

    id: str
    session_id: str
    kind: DraftKind
    price: Optional[float]
    payment_code: Optional[str]
    text: str
    rationale: str  # buyer-only reasoning; never sent to the vendor
    tactic: Optional[str] = None
    created: datetime
    status: Literal["pending", "sent", "discarded"]
