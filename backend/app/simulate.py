"""Simulate Event: create a fresh, eligible draft event from the seed generators (A36)."""
from __future__ import annotations

import random
from datetime import timedelta

from app import deal, eligibility
from app.seed.build import Accumulator, add_buy_event, add_sell_event
from app.seed.carts import make_position
from app.seed.catalog import BUY_CATEGORIES, REQUESTORS, SCRAP_MATERIALS
from app.seed.constants import SEED, TODAY
from app.seed.pricing import round_price
from app.store import Repo


def _next_number(repo: Repo) -> int:
    return max(int(e.id.rsplit("-", 1)[1]) for e in repo.fetch("event")) + 1


def _buy(rng: random.Random, vendors, event_id: str, n: int, acc: Accumulator) -> None:
    cat = BUY_CATEGORIES[n % len(BUY_CATEGORIES)]
    for _ in range(50):
        picks = []
        for t in rng.sample(cat.templates, min(2, len(cat.templates))):
            picks.append((t, rng.randint(t.qty_lo, t.qty_hi), rng.randint(t.price_lo, t.price_hi)))
        total = deal.reference_value((q, p) for _, q, p in picks)
        if eligibility.check_value(total).eligible and total <= 350_000:
            break
    else:
        picks = [(t, t.qty_lo, t.price_lo) for t in cat.templates[:2]]
    created = TODAY - timedelta(days=3)
    positions = [
        make_position(cart_no=str(1012400000 + n), pos=pos, description=t.description, cat=cat,
                      unit=t.unit, qty=q, price=p, created=created, order_for=("0800", "Plant Pune"),
                      requestor=rng.choice(REQUESTORS), cost_centre="2176000")
        for pos, (t, q, p) in enumerate(picks, start=1)]
    add_buy_event(rng, vendors, event_id, positions, "draft", acc)


def _sell(rng: random.Random, vendors, event_id: str, n: int, acc: Accumulator) -> None:
    material = SCRAP_MATERIALS[n % len(SCRAP_MATERIALS)]
    ref = round_price(rng.uniform(material.price_lo, material.price_hi))
    value = rng.uniform(40_000, 850_000)
    qty = max(10, round(value / ref / 10) * 10)
    add_sell_event(rng, vendors, event_id, i=n, material=material, qty=qty, ref=ref,
                   stage="draft", acc=acc, created_days_ago=2)


def simulate_event(repo: Repo, direction: str) -> str:
    if direction not in ("buy", "sell"):
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}")
    n = _next_number(repo)
    event_id = f"EVT-2026-{n:03d}"
    rng = random.Random(SEED + 1000 + n)
    vendors = repo.fetch("vendor")
    acc = Accumulator()
    {"buy": _buy, "sell": _sell}[direction](rng, vendors, event_id, n, acc)
    with repo.transaction():
        for e in acc.events:
            repo.put("event", e.id, e)
        for i in acc.items:
            repo.put("item", i.id, i, parent=i.event_id)
        for b in acc.scripted:
            repo.put("scripted_bid", b.id, b, parent=b.item_id)
        for bid_id, value in acc.reserves.items():
            repo.put("reserve", bid_id, value)
    return event_id
