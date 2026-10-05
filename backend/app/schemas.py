"""Explicit API response models. Nothing here carries a vendor reserve."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.models import Direction, DraftKind, ItemState, Language, Mode, Objective, SessionStatus, Unit

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
    original_value: Optional[float]
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
    vendor_name: str
    direction: Direction
    category_key: str
    unit: Unit
    unit_price: float
    qty: float
    value: float  # quantity x price
    negotiated: bool
    original_price: Optional[float]
    benchmark: Optional[float]  # what the deal is judged against: the original quote, or the average of similar deals
    basis: str  # which of the two the benchmark is
    result: Optional[float]  # gain (+) or loss (-) against the benchmark, in rupees
    result_pct: Optional[float]
    decision: Optional[Literal["gain", "even", "loss"]]


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


class Toughness(BaseModel):
    """How hard a vendor has been to move, judged from its past negotiated deals."""
    level: Literal["unknown", "flexible", "firm", "hard"]
    negotiated_deals: int
    average_concession_pct: Optional[float]  # average share of the original price the negotiation moved, in %
    note: str


class Invitee(BaseModel):
    vendor_id: str
    vendor_name: str
    rating: float
    language: Language
    responded: bool
    toughness: Toughness


class NextVendor(BaseModel):
    """A vendor that has quoted on the item and has not been negotiated with yet, best first."""
    vendor_id: str
    vendor_name: str
    unit_price: float
    effective_price: float
    payment_code: str
    rating: float
    within_limit: bool
    toughness: Toughness


class ItemDetail(BaseModel):
    item: ItemView
    event: EventView
    invitees: list[Invitee]
    comparison: ComparisonView
    outcome: Optional[OutcomeView]
    value_eligibility: EligibilityView
    bids_eligibility: EligibilityView
    active_session_id: Optional[str] = None
    latest_session_status: Optional[str] = None
    next_vendors: list[NextVendor] = []  # who to try next when a negotiation did not end in a deal


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
    toughness: Toughness


class VendorBidRow(BaseModel):
    item_id: str
    event_id: str
    description: str
    unit_price: float
    qty: float


class VendorDetail(BaseModel):
    vendor: VendorView
    history: list[HistoryPoint]
    history_summary: HistorySummary
    recent_bids: list[VendorBidRow]


class Health(BaseModel):
    status: str


class ResetResult(BaseModel):
    events: int


class ItemRow(ItemView):
    """An item with just enough event context for cross-event lists."""

    event_title: str
    direction: Direction
    category: str
    category_key: str
    event_status: EventStatus


class HistoryRow(HistoryPoint):
    value_delta: Optional[float]


class HistorySummary(BaseModel):
    deals: int
    negotiated_deals: int
    gains: int
    evens: int
    losses: int
    net_result: float  # total gain or loss across the deals judged


class HistoryDeal(BaseModel):
    deal: HistoryPoint
    similar: list[HistoryPoint]  # other past deals for the same item, newest first
    average_similar: Optional[float]
    vendor_rating: float
    explanation: str


# --- negotiation sessions ------------------------------------------------------------------

class InsightView(BaseModel):
    kind: str
    tone: Literal["info", "good", "warn"]
    text: str  # a private note for the buyer; never sent to the vendor


class TurnView(BaseModel):
    seq: int
    speaker: Literal["us", "vendor"]
    author: Literal["bot", "human", "vendor"]  # for the buyer's own audit trail
    text: str
    price: Optional[float]
    payment_code: Optional[str]
    at: datetime
    tactic: Optional[str] = None  # what the message was doing, for the buyer
    delay_minutes: int = 0  # how long after the previous message this one came (conversation time)
    elapsed_minutes: int = 0  # since the first message
    insights: list[InsightView] = []  # private notes for the buyer about this reply


class DraftView(BaseModel):
    id: str
    kind: DraftKind
    price: Optional[float]
    payment_code: Optional[str]
    text: str
    rationale: str  # shown to the buyer only
    tactic: Optional[str] = None
    created: datetime


class Intelligence(BaseModel):
    current_bid: float
    target: float
    limit: float
    latest_vendor_offer: float
    our_offer: Optional[float]
    movement: float  # improvement per unit since the vendor's opening quote
    potential_delta: float
    delta_if_accepted: Optional[float]
    within_limit: bool
    recommendation: str


class Strategy(BaseModel):
    """Where the conversation stands, from what the vendor has actually done (never its hidden settings)."""
    round: int
    max_rounds: int
    phase: Literal["opening", "probing", "trading", "pressing", "closing", "done"]
    stance: Literal["unknown", "open", "firm", "open_on_terms", "crawling"]
    stance_note: str
    mood: int  # 0 calm .. 100 about to walk away, inferred from the vendor's own replies
    mood_label: Literal["calm", "impatient", "frustrated", "walking_away"]
    tactics_used: list[str]
    elapsed_minutes: int  # conversation time so far
    alternative: Optional[str]  # the next-best quote, if another vendor quoted
    history: Toughness


class SessionSummary(BaseModel):
    id: str
    item_id: str
    vendor_id: str
    vendor_name: str
    mode: Mode
    status: SessionStatus
    round: int
    started_at: datetime
    agreed_price: Optional[float]


class SessionRow(SessionSummary):
    """One negotiation in the all-negotiations list: the summary plus where it belongs."""
    event_id: str
    event_title: str
    item_description: str
    direction: Direction
    qty: float
    unit: str
    original_price: float
    vendor_offer: float
    ended_at: Optional[datetime]



class SessionActions(BaseModel):
    can_advance: bool
    can_send: bool
    can_accept_offer: bool
    can_hand_back: bool
    can_continue: bool
    can_accept_deal: bool


class SessionView(SessionSummary):
    event_id: str
    actions: SessionActions
    item_description: str
    direction: Direction
    language: Language
    unit: Unit
    qty: float
    original_price: float
    our_offer: Optional[float]
    vendor_offer: float
    vendor_payment: str
    vendor_final: bool
    agreed_payment: Optional[str]
    agreed_delta: Optional[float]
    original_value: float  # quantity x the vendor's original price
    agreed_value: Optional[float]  # quantity x the agreed price
    handback_reason: Optional[str]
    vendor_ended: bool  # the vendor ended the conversation
    ended_at: Optional[datetime]
    turns: list[TurnView]
    pending_draft: Optional[DraftView]
    intelligence: Intelligence
    strategy: Strategy
