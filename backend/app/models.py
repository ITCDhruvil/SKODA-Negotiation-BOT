"""Domain models. Bid.reserve is a simulated vendor's hidden walk-away price: never expose it."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

Direction = Literal["buy", "sell"]
Unit = Literal["EA", "AU", "KG", "TON", "LOT"]
Language = Literal["en", "hi", "mr"]
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
    stage: EventStage


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


class Bid(_Model):
    id: str
    item_id: str
    vendor_id: str
    unit_price: float
    reserve: float
    payment_code: str
    incoterm: str
    delivery_days: int
    validity_days: int
    warranty_months: int
    penalty_clause: str = ""
    language: Language = "en"


class Outcome(_Model):
    item_id: str
    vendor_id: str
    direction: Direction
    qty: float
    original_price: float
    final_price: float
    closed_date: date
    duration_minutes: int


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

    def event_items(self, event_id: str) -> list[Item]:
        return [i for i in self.items if i.event_id == event_id]

    def item_bids(self, item_id: str, scripted: bool = False) -> list[Bid]:
        source = self.scripted_bids if scripted else self.bids
        return [b for b in source if b.item_id == item_id]

    def event_value(self, event_id: str) -> float:
        return round(sum(i.qty * i.reference_price for i in self.event_items(event_id)), 2)
