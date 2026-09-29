from __future__ import annotations

import random
from dataclasses import dataclass

from app.seed.catalog import SCRAP_MATERIALS, ScrapMaterial
from app.seed.pricing import round_price

OVERSIZE = {1: 20000, 7: 60000}  # kg; both exceed INR 10 lakh
UNDERSIZE = {14: 40}  # kg; below INR 2,000


@dataclass(frozen=True)
class LotSpec:
    material: ScrapMaterial
    qty: int
    ref: float


def make_lots(rng: random.Random) -> list[LotSpec]:
    lots: list[LotSpec] = []
    for i in range(24):
        m = SCRAP_MATERIALS[i % len(SCRAP_MATERIALS)]
        ref = round_price(rng.uniform(m.price_lo, m.price_hi))
        if i in OVERSIZE:
            qty = OVERSIZE[i]
        elif i in UNDERSIZE:
            qty = UNDERSIZE[i]
        else:
            target_value = rng.uniform(40_000, 850_000)
            qty = max(10, round(target_value / ref / 10) * 10)
        lots.append(LotSpec(m, qty, ref))
    return lots
