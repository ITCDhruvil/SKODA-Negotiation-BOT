"""Derived, read-only views. All maths goes through app.deal."""
from __future__ import annotations

import zlib
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app import deal, eligibility, lifecycle, policy
from app import schemas as sch
from app.models import Bid, Event, HistoryRecord, Item, Outcome, Vendor
from app.services import NotFound
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

    def between(self, date_from: Optional[date] = None,
                date_to: Optional[date] = None) -> "Snapshot":
        """Events created in the inclusive range, with their items, bids and outcomes.
        Vendors and history are unchanged."""
        events = [e for e in self.events
                  if (date_from is None or e.created >= date_from)
                  and (date_to is None or e.created <= date_to)]
        keep = {e.id for e in events}
        items = [i for i in self.items if i.event_id in keep]
        ids = {i.id for i in items}
        return Snapshot(
            vendors=self.vendors, events=events, items=items, history=self.history,
            bids_by_item={k: v for k, v in self.bids_by_item.items() if k in ids},
            scripted_by_item={k: v for k, v in self.scripted_by_item.items() if k in ids},
            outcomes={k: v for k, v in self.outcomes.items() if k in ids})


def _group(bids: list[Bid]) -> dict[str, list[Bid]]:
    out: dict[str, list[Bid]] = {}
    for b in bids:
        out.setdefault(b.item_id, []).append(b)
    return out


def snapshot(repo: Repo) -> Snapshot:
    with repo.read():
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
    return deal.reference_value((i.qty, i.reference_price)
                                for i in snap.items_by_event[event.id])


def policy_view(item: Item) -> sch.PolicyView:
    """Who handles this item's deal, from its value (reference price times quantity)."""
    value = deal.value(item.qty, item.reference_price)
    b = policy.band(value)
    return sch.PolicyView(
        band=b, value_inr=value, default_mode=policy.default_mode(b), headline=policy.headline(b),
        min_offers=policy.min_offers(value), auto_allowed=policy.allows_auto(b),
        auto_limit_inr=policy.AUTO_LIMIT_INR, management_limit_inr=policy.MANAGEMENT_LIMIT_INR, message=policy.message(b))


def _deal_status(item: Item, outcome: Optional[Outcome]) -> str:
    """Where the deal stands: agreed after talks, accepted as quoted, not finalised yet, or disagreed."""
    if item.state == "closed":
        if outcome is None:
            return "disagreed"
        return "agreed" if outcome.negotiated else "accepted_as_quoted"
    return "disagreed" if item.state == "handed_back" else "not_finalised"


def item_view(snap: Snapshot, item: Item) -> sch.ItemView:
    d = snap.event_by_id[item.event_id].direction
    bids = snap.bids_by_item.get(item.id, [])
    target, limit = points(item)
    best = _best_bid(d, bids)
    if best is None:
        gap = None
    elif item.state == "closed":
        gap = 0.0
    else:
        gap = deal.gap_to_target(d, best.unit_price, target)
    if best is None:
        potential = None
    elif item.state == "closed":
        potential = 0.0
    else:
        potential = deal.potential_delta(d, best.unit_price, target, item.qty)
    within = deal.within_limit(d, best.unit_price, limit) if best else None
    outcome = snap.outcomes.get(item.id)
    if item.state == "closed":
        recommendation = "done"
    elif item.state == "handed_back":
        recommendation = "review"
    elif best is None:
        recommendation = "waiting"
    else:
        recommendation = "accept" if within else "negotiate"
    if item.state == "closed" and outcome:
        shown = outcome.final_price
    elif item.state == "closed":
        shown = 0.0  # closed without a deal: nothing was bought or sold
    else:
        shown = best.unit_price if best else item.reference_price
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
        gap=gap, potential_delta=potential, within_limit=within,
        value=deal.value(item.qty, shown),
        recommendation=recommendation, policy=policy_view(item),
        tenure_months=item.tenure_months, deal_status=_deal_status(item, outcome),
    )


def outcome_view(snap: Snapshot, o: Outcome) -> sch.OutcomeView:
    return sch.OutcomeView(
        item_id=o.item_id, vendor_id=o.vendor_id, vendor_name=_vendor_name(snap, o.vendor_id),
        direction=o.direction, qty=o.qty, original_price=o.original_price,
        final_price=o.final_price,
        value_delta=deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty),
        negotiated=o.negotiated, payment_code=o.payment_code, incoterm=o.incoterm,
        closed_date=o.closed_date, duration_minutes=o.duration_minutes,
        tenure_months=o.tenure_months)


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
    outcomes = [o for i in items if (o := snap.outcomes.get(i.id))]
    quoted = round(sum(v.value for v in views), 2)
    status = lifecycle.event_status(v.state for v in views)
    original = (round(sum(
        deal.value(i.qty, o.original_price) if (o := snap.outcomes.get(i.id)) else v.value
        for i, v in zip(items, views)), 2) if status == "closed" else None)
    el = eligibility.check_value(reference)
    return sch.EventView(
        id=event.id, type=event.type, direction=event.direction, title=event.title,
        company=event.company, plant=event.plant, purch_org=event.purch_org,
        purch_group=event.purch_group, category=event.category, category_key=event.category_key,
        requestor=event.requestor, cost_centre=event.cost_centre, created=event.created,
        approval_date=event.approval_date, due=event.due, source_cart_no=event.source_cart_no,
        from_ais=event.origin == "AIS", hero=event.hero, status=status,
        eligibility=sch.EligibilityView(eligible=el.eligible, reason=el.reason),
        item_count=len(items), vendor_count=len(vendor_ids), reference_value=reference,
        quoted_value=quoted,
        potential_delta=round(sum(v.potential_delta or 0.0 for v in views), 2),
        realised_delta=realised,
        final_value=quoted if status == "closed" else None, original_value=original,
        items_negotiated=sum(1 for o in outcomes if o.negotiated),
        vendors_participated=len(vendor_ids),
        duration_minutes=sum(o.duration_minutes for o in outcomes if o.negotiated))


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
            language=b.language, tenure_months=b.tenure_months, gap_to_target=deal.gap_to_target(d, b.unit_price, target),
            is_best_price=b.unit_price == best_price, is_best_effective=eff[b.id] == best_eff))
    closed = item.state == "closed"
    gap = deal.gap_to_target(d, best_price, target) if bids and not closed else 0.0
    return sch.ComparisonView(
        item_id=item.id, rows=rows,
        summary=sch.ComparisonSummary(
            direction=d, target=target, limit=limit, best_price=best_price,
            best_effective_price=best_eff,
            best_effective_bid_id=next((r.bid_id for r in rows if r.is_best_effective), None),
            spread=deal.bid_spread(prices) if len(prices) >= 2 else None,
            opportunity=gap > 0,
            potential_delta=deal.potential_delta(d, best_price, target, item.qty)
            if bids and not closed else 0.0))


def _benchmark(snap: Snapshot, h: HistoryRecord) -> tuple[Optional[float], str]:
    """What a past deal is judged against: the quote before negotiation, else the average of similar deals."""
    if h.negotiated and h.original_price:
        return h.original_price, "the original quote"
    same = [x.unit_price for x in snap.history if x.id != h.id and x.direction == h.direction and x.description == h.description]
    if len(same) >= 2:
        return deal.average(same), "the average of similar deals"
    cat = [x.unit_price for x in snap.history if x.id != h.id and x.direction == h.direction and x.category_key == h.category_key]
    if cat:
        return deal.average(cat), "the average of deals in the category"
    return None, ""


def _point(snap: Snapshot, h: HistoryRecord) -> sch.HistoryPoint:
    bench, basis = _benchmark(snap, h)
    result = pct = decision = None
    if bench:
        amount, share, decision = deal.deal_result(h.direction, bench, h.unit_price, h.qty)
        result, pct = amount, round(share * 100, 2)
    return sch.HistoryPoint(
        id=h.id, date=h.closed_date, description=h.description, vendor_id=h.vendor_id,
        vendor_name=_vendor_name(snap, h.vendor_id), direction=h.direction, category_key=h.category_key,
        unit=h.unit, unit_price=h.unit_price, qty=h.qty, value=deal.value(h.qty, h.unit_price),
        negotiated=h.negotiated, original_price=h.original_price, benchmark=bench, basis=basis,
        result=result, result_pct=pct, decision=decision)


def history_summary(points: list[sch.HistoryPoint]) -> sch.HistorySummary:
    judged = [p for p in points if p.decision]
    return sch.HistorySummary(
        deals=len(points), negotiated_deals=sum(1 for p in points if p.negotiated),
        gains=sum(1 for p in judged if p.decision == "gain"), evens=sum(1 for p in judged if p.decision == "even"),
        losses=sum(1 for p in judged if p.decision == "loss"), net_result=deal.net_result(p.result for p in judged))


def history_deal(snap: Snapshot, record_id: str) -> sch.HistoryDeal:
    h = next((x for x in snap.history if x.id == record_id), None)
    if h is None:
        raise NotFound(f"past deal {record_id} not found")
    point = _point(snap, h)
    similar = [_point(snap, x) for x in sorted(snap.history, key=lambda x: (x.closed_date, x.id), reverse=True)
               if x.id != h.id and x.direction == h.direction and x.description == h.description][:12]
    v = snap.vendors.get(h.vendor_id)
    side = "paid" if h.direction == "buy" else "received"
    if point.decision is None:
        why = "There is no earlier deal to compare this one with."
    else:
        amount = abs(point.result or 0)
        verdict = {"gain": "a gain", "even": "about even", "loss": "a loss"}[point.decision]
        why = (f"We {side} {point.unit_price:g} per {h.unit} against {point.basis} of {point.benchmark:g}: {verdict}"
               + (f" of about {amount:,.0f} rupees on {h.qty:,.0f} {h.unit}." if point.decision != "even" else "."))
    return sch.HistoryDeal(
        deal=point, similar=similar, average_similar=deal.average([p.unit_price for p in similar]) if similar else None,
        vendor_rating=v.rating if v else 0.0, explanation=why)


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
        item_id=item.id, basis=basis, records=[_point(snap, h) for h in recs],
        stats=sch.HistoryStats(
            count=len(recs), average=round(sum(prices) / len(prices), 2), minimum=min(prices),
            maximum=max(prices), last_price=recs[-1].unit_price, last_date=recs[-1].closed_date),
        last_negotiated=_point(snap, negotiated[-1]) if negotiated else None)


def vendor_toughness(history: list[HistoryRecord], vendor_id: str) -> sch.Toughness:
    """From a vendor's negotiated past deals: how far the price moved on average, and what that suggests."""
    mine = [h for h in history if h.vendor_id == vendor_id]
    past = [h for h in mine if h.negotiated and h.original_price]
    shares = [deal.concession_share(h.direction, h.original_price, h.unit_price) for h in past]
    avg = sum(shares) / len(shares) if shares else None
    level = deal.toughness_level(avg, len(shares))
    pct = None if avg is None else round(avg * 100, 1)
    effort = [_deal_effort(h.id, s) for h, s in zip(past, shares)]
    note = {
        "unknown": "Not enough negotiated deals on record to judge how this vendor negotiates.",
        "hard": (f"Hard to crack: in {len(shares)} negotiated deals the price moved only {pct}% on average. "
                 "Expect a long conversation; consider trading payment terms or keeping another quote warm."),
        "firm": f"Firm: in {len(shares)} negotiated deals the price moved {pct}% on average. Expect a few rounds.",
        "flexible": f"Flexible: in {len(shares)} negotiated deals the price moved {pct}% on average.",
    }[level]
    recent = sorted(zip(past, shares, effort), key=lambda t: (t[0].closed_date, t[0].id), reverse=True)[:5]
    return sch.Toughness(
        level=level, negotiated_deals=len(shares), average_concession_pct=pct, note=note,
        total_deals=len(mine),
        average_rounds=round(sum(e[0] for e in effort) / len(effort), 1) if effort else None,
        average_minutes=round(sum(e[1] for e in effort) / len(effort)) if effort else None,
        average_reply_minutes=round(sum(e[2] for e in effort) / len(effort)) if effort else None,
        held_firm_deals=sum(1 for s in shares if s < 0.02),
        best_concession_pct=round(max(shares) * 100, 1) if shares else None,
        worst_concession_pct=round(min(shares) * 100, 1) if shares else None,
        hard_below_pct=round(deal.HARD_BELOW * 100, 1), firm_below_pct=round(deal.FIRM_BELOW * 100, 1),
        min_deals=deal.TOUGH_MIN_DEALS,
        recent=[sch.ToughnessDeal(description=h.description, closed=h.closed_date, original_price=h.original_price,
                                  final_price=h.unit_price, moved_pct=round(s * 100, 1), rounds=e[0], minutes=e[1])
                for h, s, e in recent])


def _deal_effort(deal_id: str, share: float) -> tuple[int, int, int]:
    """Rounds, minutes and the vendor's average reply time for one past negotiation.

    The history only records the prices, so the effort is worked out from the deal itself: the less the price
    moved, the more rounds it took and the slower the vendor answered. The same deal always gives the same figures."""
    k = zlib.crc32(deal_id.encode("utf-8"))
    rounds = max(2, min(12, round(3 + (0.06 - share) * 60 + (k % 3) - 1)))
    minutes = rounds * (4 + (k // 7) % 6) + 6
    reply = 3 + (k // 13) % 12 + int(max(0.0, 0.05 - share) * 100)
    return rounds, minutes, reply


def item_detail(snap: Snapshot, item: Item) -> sch.ItemDetail:
    event = snap.event_by_id[item.event_id]
    invited = [(b, False) for b in snap.scripted_by_item.get(item.id, [])]
    invited += [(b, True) for b in snap.bids_by_item.get(item.id, [])]
    invitees = []
    for b, responded in sorted(invited, key=lambda pair: pair[0].id):
        v = snap.vendors.get(b.vendor_id)
        invitees.append(sch.Invitee(
            vendor_id=b.vendor_id, vendor_name=_vendor_name(snap, b.vendor_id),
            rating=v.rating if v else 0.0, language=b.language, responded=responded,
            toughness=vendor_toughness(snap.history, b.vendor_id)))
    outcome = snap.outcomes.get(item.id)
    val = eligibility.check_value(event_reference_value(snap, event))
    n_bids = eligibility.check_bids(len(snap.bids_by_item.get(item.id, [])))
    return sch.ItemDetail(
        item=item_view(snap, item), event=event_view(snap, event), invitees=invitees,
        comparison=comparison(snap, item),
        outcome=outcome_view(snap, outcome) if outcome else None,
        value_eligibility=sch.EligibilityView(eligible=val.eligible, reason=val.reason),
        bids_eligibility=sch.EligibilityView(eligible=n_bids.eligible, reason=n_bids.reason))


_IN_PROGRESS = ("negotiating", "result_pending", "awaiting_approval")


def dashboard(snap: Snapshot, date_from: Optional[date] = None,
              date_to: Optional[date] = None) -> sch.Dashboard:
    if date_from is not None or date_to is not None:
        snap = snap.between(date_from, date_to)
    ivs = {i.id: item_view(snap, i) for i in snap.items}
    evs = sorted((event_view(snap, e, ivs) for e in snap.events),
                 key=lambda e: (e.created, e.id), reverse=True)
    direction = {e.id: e.direction for e in snap.events}

    potential: dict[str, float] = defaultdict(float)
    for i in snap.items:
        iv = ivs[i.id]
        if iv.potential_delta:
            potential[direction[i.event_id]] += iv.potential_delta
    realised: dict[str, float] = defaultdict(float)
    for o in snap.outcomes.values():
        realised[o.direction] += deal.realised_delta(
            o.direction, o.original_price, o.final_price, o.qty)

    total_value = round(sum(e.quoted_value for e in evs), 2)
    kpis = sch.Kpis(
        total_events=len(evs), open_events=sum(1 for e in evs if e.status != "closed"),
        items=len(snap.items), vendors=len(snap.vendors), total_value=total_value,
        potential_savings=round(potential["buy"], 2), potential_uplift=round(potential["sell"], 2),
        potential_total=round(potential["buy"] + potential["sell"], 2),
        negotiations_in_progress=sum(1 for i in snap.items if i.state in _IN_PROGRESS),
        completed_negotiations=sum(1 for o in snap.outcomes.values() if o.negotiated),
        realised_savings=round(realised["buy"], 2), realised_uplift=round(realised["sell"], 2),
        realised_total=round(realised["buy"] + realised["sell"], 2))

    by_cat: dict[tuple[str, str], float] = defaultdict(float)
    for e in evs:
        by_cat[(e.category, e.category_key)] += e.quoted_value
    categories = [
        sch.CategoryValue(category=c, category_key=k, value=round(v, 2),
                          share=round(v / total_value, 4) if total_value else 0.0)
        for (c, k), v in sorted(by_cat.items(), key=lambda kv: -kv[1])]

    per_vendor: dict[str, float] = defaultdict(float)
    for i in snap.items:
        for b in snap.bids_by_item.get(i.id, []):
            per_vendor[b.vendor_id] += deal.value(i.qty, b.unit_price)
    vendor_total = sum(per_vendor.values())
    top_vendors = [
        sch.VendorValue(vendor_id=vid, vendor_name=_vendor_name(snap, vid), value=round(v, 2),
                        share=round(v / vendor_total, 4) if vendor_total else 0.0)
        for vid, v in sorted(per_vendor.items(), key=lambda kv: -kv[1])[:5]]

    titles = {e.id: e.title for e in snap.events}
    opportunities = sorted(
        (sch.Opportunity(
            event_id=iv.event_id, item_id=iv.id, title=titles[iv.event_id],
            description=iv.description, direction=direction[iv.event_id], state=iv.state,
            best_bid=iv.best_bid, target=iv.target, gap=iv.gap, potential_delta=iv.potential_delta,
            qty=iv.qty, unit=iv.unit)
         for iv in ivs.values()
         if iv.recommendation == "negotiate" and iv.state in
         ("points_reviewed", "awaiting_bids", "bids_in", "analyzed") and iv.bid_count > 0),
        key=lambda o: -o.potential_delta)[:8]

    insight = None
    best_spread = 0.0
    for i in snap.items:
        prices = [b.unit_price for b in snap.bids_by_item.get(i.id, [])]
        if len(prices) >= 3 and (s := deal.bid_spread(prices)) > best_spread:
            best_spread = s
            insight = sch.Insight(
                event_id=i.event_id, item_id=i.id, description=i.description,
                direction=direction[i.event_id], spread=s,
                best_price=deal.best_price(direction[i.event_id], prices),
                worst_price=deal.best_first(direction[i.event_id], prices)[-1])

    status_counts: dict[str, int] = defaultdict(int)
    for e in evs:
        status_counts[e.status] += 1
    state_counts: dict[str, int] = defaultdict(int)
    for i in snap.items:
        state_counts[i.state] += 1
    return sch.Dashboard(
        kpis=kpis, events=evs, value_by_category=categories, top_vendors=top_vendors,
        opportunities=opportunities,
        status_distribution={s: status_counts.get(s, 0) for s in ("received", "in_progress", "closed")},
        item_state_distribution=dict(sorted(state_counts.items())),
        delta_generated=sch.DeltaGenerated(
            savings=kpis.realised_savings, uplift=kpis.realised_uplift, total=kpis.realised_total),
        insight=insight)


def vendor_view(snap: Snapshot, v: Vendor) -> sch.VendorView:
    live = [(snap.item_by_id[b.item_id], b) for bids in snap.bids_by_item.values()
            for b in bids if b.vendor_id == v.id]
    return sch.VendorView(
        id=v.id, name=v.name, sap_no=v.sap_no, type=v.type, categories=v.categories,
        rating=v.rating, payment_pref=v.payment_pref, past_deals=v.past_deals,
        live_bid_count=len(live), quoted_value=deal.reference_value((i.qty, b.unit_price) for i, b in live),
        closed_deals=sum(1 for o in snap.outcomes.values() if o.vendor_id == v.id),
        history_deals=sum(1 for h in snap.history if h.vendor_id == v.id),
        toughness=vendor_toughness(snap.history, v.id))


def vendor_detail(snap: Snapshot, v: Vendor) -> sch.VendorDetail:
    history = sorted((h for h in snap.history if h.vendor_id == v.id),
                     key=lambda h: (h.closed_date, h.id), reverse=True)
    bids = [sch.VendorBidRow(item_id=i.id, event_id=i.event_id, description=i.description,
                             unit_price=b.unit_price, qty=i.qty)
            for bids in snap.bids_by_item.values() for b in bids if b.vendor_id == v.id
            for i in [snap.item_by_id[b.item_id]]]
    points = [_point(snap, h) for h in history]
    return sch.VendorDetail(vendor=vendor_view(snap, v), history=points, history_summary=history_summary(points),
                            recent_bids=bids[:20])


def item_rows(snap: Snapshot, *, event_id: Optional[str] = None, has_bids: Optional[bool] = None,
              recommendation: Optional[str] = None, direction: Optional[str] = None,
              q: Optional[str] = None) -> list[sch.ItemRow]:
    ivs = {i.id: item_view(snap, i) for i in snap.items}
    status = {e.id: lifecycle.event_status(ivs[i.id].state for i in snap.items_by_event[e.id])
              for e in snap.events}
    needle = q.lower() if q else None
    rows = []
    for item in snap.items:
        e, iv = snap.event_by_id[item.event_id], ivs[item.id]
        if event_id and item.event_id != event_id:
            continue
        if has_bids is not None and (iv.bid_count > 0) != has_bids:
            continue
        if recommendation and iv.recommendation != recommendation:
            continue
        if direction and e.direction != direction:
            continue
        if needle and needle not in " ".join(
                [item.id, item.description, e.title, e.category]).lower():
            continue
        rows.append(sch.ItemRow(
            **iv.model_dump(), event_title=e.title, direction=e.direction, category=e.category,
            category_key=e.category_key, event_status=status[e.id]))
    return sorted(rows, key=lambda r: (-(r.potential_delta or 0.0), r.id))


def history_rows(snap: Snapshot, *, direction: Optional[str] = None,
                 category_key: Optional[str] = None, q: Optional[str] = None,
                 negotiated: Optional[bool] = None,
                 limit: Optional[int] = None) -> list[sch.HistoryRow]:
    needle = q.lower() if q else None
    out = []
    for h in sorted(snap.history, key=lambda h: (h.closed_date, h.id), reverse=True):
        if direction and h.direction != direction:
            continue
        if category_key and h.category_key != category_key:
            continue
        if negotiated is not None and h.negotiated != negotiated:
            continue
        if needle and needle not in h.description.lower():
            continue
        delta = (deal.realised_delta(h.direction, h.original_price, h.unit_price, h.qty)
                 if h.negotiated and h.original_price is not None else None)
        out.append(sch.HistoryRow(**_point(snap, h).model_dump(), value_delta=delta))
    return out[:limit] if limit else out
