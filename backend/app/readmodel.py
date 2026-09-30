"""Derived, read-only views. All maths goes through app.deal."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app import deal, eligibility, lifecycle
from app import schemas as sch
from app.models import Bid, Event, HistoryRecord, Item, Outcome, Vendor
from app.store import Repo


@dataclass
class Snapshot:
    vendors: dict[str, Vendor]
    events: list[Event]
    items: list[Item]
    history: list[HistoryRecord]
    bids_by_item: dict[str, list[Bid]]
    scripted_by_item: dict[str, list[Bid]]
    outcomes: dict[str, Outcome]
    event_by_id: dict[str, Event] = field(init=False)
    item_by_id: dict[str, Item] = field(init=False)
    items_by_event: dict[str, list[Item]] = field(init=False)

    def __post_init__(self) -> None:
        self.event_by_id = {e.id: e for e in self.events}
        self.item_by_id = {i.id: i for i in self.items}
        self.items_by_event = {e.id: [] for e in self.events}
        for i in self.items:
            self.items_by_event[i.event_id].append(i)


def _group(bids: list[Bid]) -> dict[str, list[Bid]]:
    out: dict[str, list[Bid]] = {}
    for b in bids:
        out.setdefault(b.item_id, []).append(b)
    return out


def snapshot(repo: Repo) -> Snapshot:
    return Snapshot(
        vendors={v.id: v for v in repo.fetch("vendor")},
        events=repo.fetch("event"),
        items=repo.fetch("item"),
        history=repo.fetch("history"),
        bids_by_item=_group(repo.fetch("bid")),
        scripted_by_item=_group(repo.fetch("scripted_bid")),
        outcomes={o.item_id: o for o in repo.fetch("outcome")},
    )


def points(item: Item) -> tuple[float, float]:
    """Buyer's points if set, otherwise the suggested ones."""
    return (item.target if item.target is not None else item.suggested_target,
            item.limit if item.limit is not None else item.suggested_limit)


def _vendor_name(snap: Snapshot, vendor_id: str) -> str:
    v = snap.vendors.get(vendor_id)
    return v.name if v else vendor_id


def _effective(direction: str, b: Bid) -> float:
    return deal.effective_price(
        direction, b.unit_price, payment_code=b.payment_code, incoterm=b.incoterm,
        delivery_days=b.delivery_days, warranty_months=b.warranty_months)


def _best_bid(direction: str, bids: list[Bid]) -> Optional[Bid]:
    return deal.best_first(direction, bids, key=lambda b: b.unit_price)[0] if bids else None


def event_reference_value(snap: Snapshot, event: Event) -> float:
    return round(sum(i.qty * i.reference_price for i in snap.items_by_event[event.id]), 2)


def item_view(snap: Snapshot, item: Item) -> sch.ItemView:
    d = snap.event_by_id[item.event_id].direction
    bids = snap.bids_by_item.get(item.id, [])
    target, limit = points(item)
    best = _best_bid(d, bids)
    gap = deal.gap_to_target(d, best.unit_price, target) if best else None
    if best is None:
        potential = None
    elif item.state == "closed":
        potential = 0.0
    else:
        potential = deal.potential_delta(d, best.unit_price, target, item.qty)
    if item.state == "closed":
        recommendation = "done"
    elif best is None:
        recommendation = "waiting"
    else:
        recommendation = "negotiate" if gap > 0 else "accept"
    return sch.ItemView(
        id=item.id, event_id=item.event_id, position=item.position,
        description=item.description, kind=item.kind, qty=item.qty, unit=item.unit,
        reference_price=item.reference_price, target=target, limit=limit,
        points_set=item.target is not None and item.limit is not None,
        objective=item.objective, incoterm=item.incoterm, delivery_days=item.delivery_days,
        state=item.state, bid_count=len(bids),
        min_bids_met=eligibility.check_bids(len(bids)).eligible,
        best_bid=best.unit_price if best else None,
        best_bid_vendor_id=best.vendor_id if best else None,
        best_bid_vendor=_vendor_name(snap, best.vendor_id) if best else None,
        best_effective_price=(deal.best_price(d, [_effective(d, b) for b in bids])
                              if bids else None),
        gap=gap, potential_delta=potential,
        value=deal.value(item.qty, best.unit_price if best else item.reference_price),
        recommendation=recommendation,
    )


def outcome_view(snap: Snapshot, o: Outcome) -> sch.OutcomeView:
    return sch.OutcomeView(
        item_id=o.item_id, vendor_id=o.vendor_id, vendor_name=_vendor_name(snap, o.vendor_id),
        direction=o.direction, qty=o.qty, original_price=o.original_price,
        final_price=o.final_price,
        value_delta=deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty),
        negotiated=o.negotiated, payment_code=o.payment_code, incoterm=o.incoterm,
        closed_date=o.closed_date, duration_minutes=o.duration_minutes)


def event_view(snap: Snapshot, event: Event,
               ivs: Optional[dict[str, sch.ItemView]] = None) -> sch.EventView:
    items = snap.items_by_event[event.id]
    views = [(ivs or {}).get(i.id) or item_view(snap, i) for i in items]
    vendor_ids = {b.vendor_id for i in items
                  for b in snap.bids_by_item.get(i.id, []) + snap.scripted_by_item.get(i.id, [])}
    reference = event_reference_value(snap, event)
    realised = round(sum(
        deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty)
        for i in items if (o := snap.outcomes.get(i.id))), 2)
    el = eligibility.check_value(reference)
    return sch.EventView(
        id=event.id, type=event.type, direction=event.direction, title=event.title,
        company=event.company, plant=event.plant, purch_org=event.purch_org,
        purch_group=event.purch_group, category=event.category, category_key=event.category_key,
        requestor=event.requestor, cost_centre=event.cost_centre, created=event.created,
        approval_date=event.approval_date, due=event.due, source_cart_no=event.source_cart_no,
        hero=event.hero, status=lifecycle.event_status(v.state for v in views),
        eligibility=sch.EligibilityView(eligible=el.eligible, reason=el.reason),
        item_count=len(items), vendor_count=len(vendor_ids), reference_value=reference,
        quoted_value=round(sum(v.value for v in views), 2),
        potential_delta=round(sum(v.potential_delta or 0.0 for v in views), 2),
        realised_delta=realised)


def event_detail(snap: Snapshot, event: Event) -> sch.EventDetail:
    ivs = {i.id: item_view(snap, i) for i in snap.items_by_event[event.id]}
    return sch.EventDetail(event=event_view(snap, event, ivs), items=list(ivs.values()))


def comparison(snap: Snapshot, item: Item) -> sch.ComparisonView:
    d = snap.event_by_id[item.event_id].direction
    target, limit = points(item)
    bids = snap.bids_by_item.get(item.id, [])
    eff = {b.id: _effective(d, b) for b in bids}
    prices = [b.unit_price for b in bids]
    best_price = deal.best_price(d, prices) if bids else None
    best_eff = deal.best_price(d, list(eff.values())) if bids else None
    ordered = deal.best_first(d, bids, key=lambda b: eff[b.id])
    rows = []
    for b in ordered:
        v = snap.vendors.get(b.vendor_id)
        rows.append(sch.ComparisonRow(
            bid_id=b.id, vendor_id=b.vendor_id, vendor_name=_vendor_name(snap, b.vendor_id),
            vendor_rating=v.rating if v else 0.0, unit_price=b.unit_price,
            effective_price=eff[b.id], payment_code=b.payment_code, incoterm=b.incoterm,
            delivery_days=b.delivery_days, validity_days=b.validity_days,
            warranty_months=b.warranty_months, penalty_clause=b.penalty_clause,
            language=b.language, gap_to_target=deal.gap_to_target(d, b.unit_price, target),
            is_best_price=b.unit_price == best_price, is_best_effective=eff[b.id] == best_eff))
    gap = deal.gap_to_target(d, best_price, target) if bids else 0.0
    return sch.ComparisonView(
        item_id=item.id, rows=rows,
        summary=sch.ComparisonSummary(
            direction=d, target=target, limit=limit, best_price=best_price,
            best_effective_price=best_eff,
            best_effective_bid_id=next((r.bid_id for r in rows if r.is_best_effective), None),
            spread=deal.bid_spread(prices) if len(prices) >= 2 else None,
            opportunity=gap > 0,
            potential_delta=deal.potential_delta(d, best_price, target, item.qty) if bids
            else 0.0))


def _point(h: HistoryRecord) -> sch.HistoryPoint:
    return sch.HistoryPoint(
        id=h.id, date=h.closed_date, description=h.description, vendor_id=h.vendor_id,
        unit_price=h.unit_price, qty=h.qty, negotiated=h.negotiated,
        original_price=h.original_price)


def history_view(snap: Snapshot, item: Item) -> sch.HistoryView:
    event = snap.event_by_id[item.event_id]
    same_dir = [h for h in snap.history if h.direction == event.direction]
    recs = [h for h in same_dir if h.description == item.description]
    basis = "description"
    if not recs:
        recs = [h for h in same_dir if h.category_key == event.category_key]
        basis = "category"
    if not recs:
        return sch.HistoryView(item_id=item.id, basis="none", records=[], stats=None,
                               last_negotiated=None)
    recs = sorted(recs, key=lambda h: (h.closed_date, h.id))
    prices = [h.unit_price for h in recs]
    negotiated = [h for h in recs if h.negotiated]
    return sch.HistoryView(
        item_id=item.id, basis=basis, records=[_point(h) for h in recs],
        stats=sch.HistoryStats(
            count=len(recs), average=round(sum(prices) / len(prices), 2), minimum=min(prices),
            maximum=max(prices), last_price=recs[-1].unit_price, last_date=recs[-1].closed_date),
        last_negotiated=_point(negotiated[-1]) if negotiated else None)


def item_detail(snap: Snapshot, item: Item) -> sch.ItemDetail:
    event = snap.event_by_id[item.event_id]
    invitees = []
    for b in snap.scripted_by_item.get(item.id, []):
        v = snap.vendors.get(b.vendor_id)
        invitees.append(sch.Invitee(vendor_id=b.vendor_id, vendor_name=_vendor_name(snap, b.vendor_id),
                                    rating=v.rating if v else 0.0, language=b.language))
    outcome = snap.outcomes.get(item.id)
    val = eligibility.check_value(event_reference_value(snap, event))
    n_bids = eligibility.check_bids(len(snap.bids_by_item.get(item.id, [])))
    return sch.ItemDetail(
        item=item_view(snap, item), event=event_view(snap, event), invitees=invitees,
        comparison=comparison(snap, item),
        outcome=outcome_view(snap, outcome) if outcome else None,
        value_eligibility=sch.EligibilityView(eligible=val.eligible, reason=val.reason),
        bids_eligibility=sch.EligibilityView(eligible=n_bids.eligible, reason=n_bids.reason))
