from __future__ import annotations

import math
import random
from datetime import timedelta
from pathlib import Path

from app import eligibility
from app.importer import CartPosition, parse_text, render_report
from app.models import Bid, Dataset, Event, Item, Outcome
from app.seed import heroes
from app.seed.carts import make_cart_positions
from app.seed.catalog import FAMILY_TITLES, SCRAP_REQUESTORS
from app.seed.constants import SEED, TODAY
from app.seed.history import build_history
from app.seed.pricing import round_price, step
from app.seed.scrap import make_lots
from app.seed.vendors import build_vendors, pool

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"

BUY_COUNTS = (("closed", 2), ("negotiating", 1), ("handed_back", 1), ("acceptable", 2),
              ("analyzed", 20), ("awaiting_bids", 12))
SELL_COUNTS = (("closed", 2), ("negotiating", 1), ("handed_back", 1), ("acceptable", 1),
               ("analyzed", 8), ("awaiting_bids", 5))


class _Acc:
    def __init__(self) -> None:
        self.events: list[Event] = []
        self.items: list[Item] = []
        self.bids: list[Bid] = []
        self.scripted: list[Bid] = []
        self.outcomes: list[Outcome] = []


def build_positions() -> list[CartPosition]:
    """Generate carts plus the hero cart, then round-trip them through the real parser."""
    raw = make_cart_positions(random.Random(SEED + 2)) + heroes.hero_buy_positions()
    return parse_text(render_report(raw)).positions


def _stage_plan(rng: random.Random, n: int, counts) -> list[str]:
    plan = [stage for stage, c in counts for _ in range(c)]
    plan += ["draft"] * (n - len(plan))
    rng.shuffle(plan)
    return plan


def _anchors(rng: random.Random, direction: str, best: float, acceptable: bool):
    s = step(best)
    if direction == "buy":
        if acceptable:
            limit = max(round_price(best * (1 + rng.uniform(0.01, 0.04))), round(best + s, 2))
            target = min(round_price(best * (1 - rng.uniform(0.0, 0.02))), best)
        else:
            c = rng.uniform(0.02, 0.05)
            t = c + rng.uniform(0.03, 0.06)
            limit = min(round_price(best * (1 - c)), round(best - s, 2))
            target = min(round_price(best * (1 - t)), limit)
        return target, limit
    if acceptable:
        floor = min(round_price(best * (1 - rng.uniform(0.01, 0.03))), round(best - s, 2))
        target = max(round_price(best * (1 + rng.uniform(0.02, 0.05))), round(best + s, 2))
    else:
        c = rng.uniform(0.02, 0.04)
        t = c + rng.uniform(0.02, 0.05)
        floor = max(round_price(best * (1 + c)), round(best + s, 2))
        target = max(round_price(best * (1 + t)), floor)
    return target, floor


def _bid_prices(rng: random.Random, direction: str, best: float, n: int) -> list[float]:
    lo, hi = (0.06, 0.14) if direction == "buy" else (0.04, 0.12)
    spread = rng.uniform(lo, hi)
    fractions = sorted(rng.uniform(0.05, 0.95) for _ in range(n - 2)) + [1.0]
    sign = 1 if direction == "buy" else -1
    return [best] + [round_price(best * (1 + sign * spread * f)) for f in fractions]


def _reserve(rng: random.Random, direction: str, bid: float, limit: float, no_deal: bool) -> float:
    s = step(bid)
    if direction == "buy":
        if no_deal:
            v = round_price(limit + (bid - limit) * rng.uniform(0.3, 0.8))
            return min(max(v, round(limit + s, 2)), bid)
        return min(round_price(min(bid, limit) * (1 - rng.uniform(0.005, 0.02))), bid)
    if no_deal:
        v = round_price(limit - (limit - bid) * rng.uniform(0.3, 0.8))
        return max(min(v, round(limit - s, 2)), bid)
    return max(round_price(max(bid, limit) * (1 + rng.uniform(0.005, 0.02))), bid)


def _terms(rng: random.Random, direction: str, kind: str, vendor) -> dict:
    scrap = kind == "scrap"
    return {
        "payment_code": vendor.payment_pref if rng.random() < 0.6 else rng.choice(
            ["ADV", "ZD15", "ZD30", "LC"] if scrap else ["ZD30", "ZD45", "ZD60"]),
        "incoterm": rng.choice(["EXW", "FCA"]) if scrap else (
            "FH" if kind == "service" else rng.choice(["FH", "EXW", "DAP"])),
        "delivery_days": rng.randint(2, 15) if scrap else rng.randint(3, 30),
        "validity_days": rng.choice([30, 45, 60]),
        "warranty_months": 0 if kind != "goods" else rng.choice([12, 24]),
        "penalty_clause": rng.choice(["", "LD 0.5% per week capped at 5%"]),
        "language": rng.choice(["en", "en", "hi", "mr"]),
    }


def _item_state(stage: str, idx: int) -> str:
    if stage == "negotiating":
        return "negotiating" if idx == 1 else "analyzed"
    if stage == "handed_back":
        return "handed_back" if idx == 1 else "analyzed"
    return stage


def _add_item(rng, vendors, event: Event, idx: int, n_items: int, *, desc: str, kind: str,
              qty: float, unit: str, ref: float, incoterm: str, delivery_days: int,
              acc: _Acc, hero: dict | None = None) -> None:
    d = event.direction
    item_id = f"{event.id}-{idx:02d}"
    vendor_pool = pool(vendors, event.category_key)
    no_deal = event.no_deal and idx == 1
    if hero:
        prices, target, limit = hero["prices"], hero["target"], hero["limit"]
        reserves = hero["reserves"]
        chosen = vendor_pool[: len(prices)]
        assert len(chosen) == len(prices), "not enough vendors for hero bids"
        terms = [{
            "payment_code": hero["payment_codes"][k], "incoterm": hero["incoterm"],
            "delivery_days": hero["delivery_days"][k], "validity_days": 30,
            "warranty_months": 0, "penalty_clause": "", "language": "en",
        } for k in range(len(prices))]
    else:
        factor = rng.uniform(0.97, 1.04) if d == "buy" else rng.uniform(0.97, 1.0)
        best = round_price(ref * factor)
        target, limit = _anchors(rng, d, best, event.acceptable)
        n = min(rng.randint(3, 6), len(vendor_pool))
        prices = _bid_prices(rng, d, best, n)
        chosen = rng.sample(vendor_pool, n)
        reserves = [_reserve(rng, d, p, limit, no_deal) for p in prices]
        terms = [_terms(rng, d, kind, v) for v in chosen]
    bids = [
        Bid(id=f"{item_id}-B{k}", item_id=item_id, vendor_id=v.id, unit_price=float(p),
            reserve=float(r), **t)
        for k, (p, v, r, t) in enumerate(zip(prices, chosen, reserves, terms), start=1)
    ]
    pointed = event.stage != "draft"
    acc.items.append(Item(
        id=item_id, event_id=event.id, position=idx, description=desc, kind=kind, qty=qty,
        unit=unit, reference_price=ref, suggested_target=float(target),
        suggested_limit=float(limit), target=float(target) if pointed else None,
        limit=float(limit) if pointed else None, incoterm=incoterm, delivery_days=delivery_days,
        state=_item_state(event.stage, idx),
    ))
    (acc.scripted if event.stage in ("draft", "awaiting_bids") else acc.bids).extend(bids)
    if event.stage == "closed" and idx <= math.ceil(n_items / 2):
        if d == "buy":
            final = limit - (limit - target) * rng.uniform(0.0, 0.5)
            final = min(max(round_price(final), target), limit)
        else:
            final = limit + (target - limit) * rng.uniform(0.0, 0.5)
            final = max(min(round_price(final), target), limit)
        best_bid = bids[0]
        acc.outcomes.append(Outcome(
            item_id=item_id, vendor_id=best_bid.vendor_id, direction=d, qty=qty,
            original_price=best_bid.unit_price, final_price=float(final),
            closed_date=event.approval_date + timedelta(days=8 + 3 * idx),
            duration_minutes=rng.randint(8, 35),
        ))


def _add_buy_event(rng, vendors, event_id: str, ps: list[CartPosition], stage: str,
                   acc: _Acc, hero: bool = False) -> None:
    acceptable = stage == "acceptable"
    p0 = ps[0]
    title = heroes.HERO_BUY_TITLE if hero else (
        p0.description + (f" (+{len(ps) - 1} more)" if len(ps) > 1 else ""))
    event = Event(
        id=event_id, type="shopping_cart", direction="buy", title=title,
        company_id=p0.company_id, company=p0.company, plant=p0.order_for, purch_org=p0.purch_org,
        purch_group=p0.purch_group, category=p0.eclass, category_key=p0.eclass_code,
        requestor=p0.requestor, cost_centre=p0.cost_centre, created=p0.create_date,
        approval_date=p0.approval_date, due=p0.delivery_to, source_cart_no=p0.cart_no,
        hero=hero, acceptable=acceptable, no_deal=stage == "handed_back",
        stage="analyzed" if acceptable else stage,
    )
    acc.events.append(event)
    for idx, p in enumerate(ps, start=1):
        kind = "service" if p.qty_unit == "AU" or p.eclass_code in _SERVICE_CODES else "goods"
        _add_item(rng, vendors, event, idx, len(ps), desc=p.description, kind=kind,
                  qty=p.net_qty, unit=p.qty_unit, ref=p.net_unit_price, incoterm="FH",
                  delivery_days=(p.delivery_to - p.delivery_from).days, acc=acc,
                  hero=heroes.HERO_BUY_ITEMS[idx - 1] if hero else None)


def _cart_value(ps: list[CartPosition]) -> float:
    return sum(p.net_qty * p.net_unit_price for p in ps)


def _build_buy(rng, vendors, positions, free_ids, acc) -> None:
    carts: dict[str, list[CartPosition]] = {}
    for p in positions:
        carts.setdefault(p.cart_no, []).append(p)
    procedural = [ps for cart, ps in carts.items() if cart != heroes.HERO_BUY_CART]
    ok = [eligibility.check_value(_cart_value(ps)).eligible for ps in procedural]
    plan = iter(_stage_plan(rng, sum(ok), BUY_COUNTS))
    for ps, eligible in zip(procedural, ok):
        _add_buy_event(rng, vendors, free_ids.pop(0), ps, next(plan) if eligible else "draft", acc)
    _add_buy_event(rng, vendors, heroes.HERO_BUY_ID, carts[heroes.HERO_BUY_CART], "draft", acc,
                   hero=True)


def _add_sell_event(rng, vendors, event_id: str, *, i: int, material, qty: int, ref: float,
                    stage: str, acc: _Acc, hero: dict | None = None) -> None:
    acceptable = stage == "acceptable"
    created = TODAY - timedelta(days=2 if hero else 30 + (i * 13) % 150)
    event = Event(
        id=event_id, type="scrap_sale", direction="sell",
        title=hero["title"] if hero else f"{material.description} Lot - {qty:,} kg",
        company_id="0800", company="SKODA Auto VW India", plant="Plant Pune",
        purch_org="Purchasing Organisation LPOS (SAVWIPL)", purch_group="Scrap Sales",
        category=f"Scrap - {FAMILY_TITLES[material.family]}", category_key=material.family,
        requestor=SCRAP_REQUESTORS[i % len(SCRAP_REQUESTORS)], cost_centre="2199000",
        created=created, approval_date=created + timedelta(days=1),
        due=created + timedelta(days=14 if hero else 45), source_cart_no=None,
        hero=hero is not None, acceptable=acceptable, no_deal=stage == "handed_back",
        stage="analyzed" if acceptable else stage,
    )
    acc.events.append(event)
    _add_item(rng, vendors, event, 1, 1, desc=material.description, kind="scrap",
              qty=float(qty), unit="KG", ref=ref, incoterm="EXW", delivery_days=7, acc=acc,
              hero=hero)


def _build_sell(rng, vendors, free_ids, acc) -> None:
    lots = make_lots(rng)
    ok = [eligibility.check_value(l.qty * l.ref).eligible for l in lots]
    plan = iter(_stage_plan(rng, sum(ok), SELL_COUNTS))
    for i, (lot, eligible) in enumerate(zip(lots, ok)):
        _add_sell_event(rng, vendors, free_ids.pop(0), i=i, material=lot.material, qty=lot.qty,
                        ref=lot.ref, stage=next(plan) if eligible else "draft", acc=acc)
    from app.seed.catalog import SCRAP_MATERIALS

    h = heroes.HERO_SELL
    material = next(m for m in SCRAP_MATERIALS if m.description == h["description"])
    _add_sell_event(rng, vendors, heroes.HERO_SELL_ID, i=0, material=material, qty=h["qty"],
                    ref=float(h["ref"]), stage="draft", acc=acc, hero=h)


_SERVICE_CODES = {"25200000", "41120214", "90101500", "82121500", "78101800", "86101700"}


def build_dataset() -> Dataset:
    vendors = build_vendors(random.Random(SEED + 1))
    positions = build_positions()
    rng = random.Random(SEED + 3)
    ids = [f"EVT-2026-{n:03d}" for n in range(1, 86)]
    free = [i for i in ids if i not in (heroes.HERO_BUY_ID, heroes.HERO_SELL_ID)]
    acc = _Acc()
    _build_buy(rng, vendors, positions, free, acc)
    _build_sell(rng, vendors, free, acc)
    return Dataset(
        vendors=vendors,
        events=sorted(acc.events, key=lambda e: e.id),
        items=sorted(acc.items, key=lambda i: i.id),
        bids=sorted(acc.bids, key=lambda b: b.id),
        scripted_bids=sorted(acc.scripted, key=lambda b: b.id),
        outcomes=sorted(acc.outcomes, key=lambda o: o.item_id),
        history=build_history(random.Random(SEED + 4), vendors),
    )
