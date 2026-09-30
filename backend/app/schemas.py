"""Explicit API response models. Nothing here carries a vendor reserve."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

from app.models import Direction, ItemState, Language, Objective, Unit

EventStatus = Literal["received", "in_progress", "closed"]
Recommendation = Literal["waiting", "negotiate", "accept", "review", "done"]


class EligibilityView(BaseModel):
    eligible: bool
    reason: str = ""


class ItemView(BaseModel):
    id: str
    event_id: str
    position: int
    description: str
    kind: Literal["service", "goods", "scrap"]
    qty: float
    unit: Unit
    reference_price: float
    target: float
    limit: float
    points_set: bool
    objective: Optional[Objective]
    incoterm: str
    delivery_days: int
    state: ItemState
    bid_count: int
    min_bids_met: bool
    best_bid: Optional[float]
    best_bid_vendor_id: Optional[str]
    best_bid_vendor: Optional[str]
    best_effective_price: Optional[float]
    gap: Optional[float]
    potential_delta: Optional[float]
    within_limit: Optional[bool]
    value: float
    recommendation: Recommendation


class EventView(BaseModel):
    id: str
    type: Literal["shopping_cart", "scrap_sale"]
    direction: Direction
    title: str
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
    status: EventStatus
    eligibility: EligibilityView
    item_count: int
    vendor_count: int
    reference_value: float
    quoted_value: float
    potential_delta: float
    realised_delta: float
    final_value: Optional[float]
    items_negotiated: int
    vendors_participated: int
    duration_minutes: int


class EventDetail(BaseModel):
    event: EventView
    items: list[ItemView]


class ComparisonRow(BaseModel):
    bid_id: str
    vendor_id: str
    vendor_name: str
    vendor_rating: float
    unit_price: float
    effective_price: float
    payment_code: str
    incoterm: str
    delivery_days: int
    validity_days: int
    warranty_months: int
    penalty_clause: str
    language: Language
    gap_to_target: float
    is_best_price: bool
    is_best_effective: bool


class ComparisonSummary(BaseModel):
    direction: Direction
    target: float
    limit: float
    best_price: Optional[float]
    best_effective_price: Optional[float]
    best_effective_bid_id: Optional[str]
    spread: Optional[float]
    opportunity: bool
    potential_delta: float


class ComparisonView(BaseModel):
    item_id: str
    rows: list[ComparisonRow]
    summary: ComparisonSummary


class HistoryPoint(BaseModel):
    id: str
    date: date
    description: str
    vendor_id: str
    unit_price: float
    qty: float
    negotiated: bool
    original_price: Optional[float]


class HistoryStats(BaseModel):
    count: int
    average: float
    minimum: float
    maximum: float
    last_price: float
    last_date: date


class HistoryView(BaseModel):
    item_id: str
    basis: Literal["description", "category", "none"]
    records: list[HistoryPoint]
    stats: Optional[HistoryStats]
    last_negotiated: Optional[HistoryPoint]


class OutcomeView(BaseModel):
    item_id: str
    vendor_id: str
    vendor_name: str
    direction: Direction
    qty: float
    original_price: float
    final_price: float
    value_delta: float
    negotiated: bool
    payment_code: str
    incoterm: str
    closed_date: date
    duration_minutes: int


class Invitee(BaseModel):
    vendor_id: str
    vendor_name: str
    rating: float
    language: Language
    responded: bool


class ItemDetail(BaseModel):
    item: ItemView
    event: EventView
    invitees: list[Invitee]
    comparison: ComparisonView
    outcome: Optional[OutcomeView]
    value_eligibility: EligibilityView
    bids_eligibility: EligibilityView


class Kpis(BaseModel):
    total_events: int
    open_events: int
    items: int
    vendors: int
    total_value: float
    potential_savings: float
    potential_uplift: float
    potential_total: float
    negotiations_in_progress: int
    completed_negotiations: int
    realised_savings: float
    realised_uplift: float
    realised_total: float


class CategoryValue(BaseModel):
    category: str
    category_key: str
    value: float
    share: float


class VendorValue(BaseModel):
    vendor_id: str
    vendor_name: str
    value: float
    share: float


class Opportunity(BaseModel):
    event_id: str
    item_id: str
    title: str
    description: str
    direction: Direction
    state: ItemState
    best_bid: float
    target: float
    gap: float
    potential_delta: float


class Insight(BaseModel):
    event_id: str
    item_id: str
    description: str
    direction: Direction
    spread: float
    best_price: float
    worst_price: float


class DeltaGenerated(BaseModel):
    savings: float
    uplift: float
    total: float


class Dashboard(BaseModel):
    kpis: Kpis
    events: list[EventView]
    value_by_category: list[CategoryValue]
    top_vendors: list[VendorValue]
    opportunities: list[Opportunity]
    status_distribution: dict[str, int]
    item_state_distribution: dict[str, int]
    delta_generated: DeltaGenerated
    insight: Optional[Insight]


class VendorView(BaseModel):
    id: str
    name: str
    sap_no: str
    type: Literal["supplier", "scrap_buyer"]
    categories: list[str]
    rating: float
    payment_pref: str
    past_deals: int
    live_bid_count: int
    quoted_value: float
    closed_deals: int
    history_deals: int


class VendorBidRow(BaseModel):
    item_id: str
    event_id: str
    description: str
    unit_price: float
    qty: float


class VendorDetail(BaseModel):
    vendor: VendorView
    history: list[HistoryPoint]
    recent_bids: list[VendorBidRow]


class Health(BaseModel):
    status: str


class ResetResult(BaseModel):
    events: int
