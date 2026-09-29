from __future__ import annotations

import random
from datetime import timedelta

from app.models import HistoryRecord, Vendor
from app.seed.catalog import BUY_CATEGORIES, SCRAP_MATERIALS
from app.seed.constants import TODAY
from app.seed.pricing import round_price, step
from app.seed.vendors import pool

PER_TEMPLATE = 6


def build_history(rng: random.Random, vendors: list[Vendor]) -> list[HistoryRecord]:
    specs = []
    for cat in BUY_CATEGORIES:
        for t in cat.templates:
            specs.append(("buy", cat.code, t.description, t.unit, t.price_lo, t.price_hi,
                          t.qty_lo, t.qty_hi))
    for m in SCRAP_MATERIALS:
        specs.append(("sell", m.family, m.description, "KG", m.price_lo, m.price_hi, 500, 8000))

    rows: list[HistoryRecord] = []
    n = PER_TEMPLATE
    for direction, key, desc, unit, lo, hi, qlo, qhi in specs:
        vendor_pool = pool(vendors, key)
        base = (lo + hi) / 2
        for k in range(n):
            age = (n - 1 - k) / (n - 1)  # 1 = oldest
            days_ago = 30 + round(age * 480) + rng.randint(0, 10)
            if direction == "buy":
                price = base * (1 + 0.05 * (1 - age)) * (1 + rng.uniform(-0.04, 0.04))
            else:
                price = base * (1 + rng.uniform(-0.06, 0.06))
            unit_price = round_price(price)
            negotiated = k % 3 == 2
            original = None
            if negotiated:
                if direction == "buy":
                    original = max(round_price(price / (1 - rng.uniform(0.03, 0.08))),
                                   round(unit_price + step(unit_price), 2))
                else:
                    original = min(round_price(price / (1 + rng.uniform(0.03, 0.07))),
                                   round(unit_price - step(unit_price), 2))
            qty = rng.randint(qlo, qhi)
            if direction == "sell":
                qty = qty // 10 * 10
            rows.append(HistoryRecord(
                id="", description=desc, category_key=key, direction=direction,
                vendor_id=rng.choice(vendor_pool).id, unit_price=unit_price, qty=float(qty),
                unit=unit, closed_date=TODAY - timedelta(days=days_ago),
                negotiated=negotiated, original_price=original,
            ))
    rows.sort(key=lambda r: (r.closed_date, r.description))
    return [r.model_copy(update={"id": f"H{i + 1:04d}"}) for i, r in enumerate(rows)]
