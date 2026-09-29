"""Hand-authored hero events (A40, A41). Numbers are documented in the design spec section 5."""
from __future__ import annotations

from datetime import timedelta

from app.importer import CartPosition
from app.seed.carts import make_position
from app.seed.catalog import BUY_CATEGORIES
from app.seed.constants import TODAY

HERO_BUY_ID = "EVT-2026-041"
HERO_SELL_ID = "EVT-2026-052"
HERO_BUY_CART = "1012399041"
HERO_BUY_TITLE = "Meals For Delegation Visit To Savwipl"

_CODES = ["ZD30", "ZD30", "ZD45", "ZD30", "ZD60"]
_DAYS = [3, 3, 4, 3, 5]

# (position, description, unit, qty, reference price, bid prices best-first, target, ceiling,
#  hidden vendor reserves)
_BUY_ROWS = (
    (1, "Delegation Lunch Buffet", "EA", 600, 280, [285, 292, 298, 305, 312], 250, 270,
     [268, 274, 279, 285, 290]),
    (2, "Welcome Tea And Snacks", "EA", 600, 52, [53, 55, 57, 58, 60], 46, 50,
     [49, 52, 54, 56, 58]),
    (3, "Plant Visit Refreshment Kits", "EA", 200, 120, [122, 126, 129, 133, 138], 108, 115,
     [112, 118, 122, 125, 130]),
    (4, "Dinner Buffet Day 1", "EA", 150, 340, [345, 352, 360, 368, 377], 305, 325,
     [320, 330, 338, 345, 355]),
    (5, "Mineral Water 1 Ltr Cartons", "EA", 100, 260, [262, 268, 275, 281, 290], 238, 250,
     [246, 255, 262, 270, 280]),
    (6, "Service Staff And Live Counters", "AU", 1, 18000,
     [18500, 19000, 19600, 20200, 20800], 16500, 17500, [17200, 17800, 18400, 19000, 19800]),
)

HERO_BUY_ITEMS = tuple(
    {
        "position": pos, "description": desc, "unit": unit, "qty": qty, "ref": ref,
        "prices": prices, "target": target, "limit": limit, "reserves": reserves,
        "payment_codes": _CODES, "delivery_days": _DAYS, "incoterm": "FH",
    }
    for pos, desc, unit, qty, ref, prices, target, limit, reserves in _BUY_ROWS
)

HERO_SELL = {
    "title": "Aluminium Turnings Lot - 5,000 kg",
    "description": "Aluminium Turnings",
    "family": "aluminium",
    "qty": 5000,
    "ref": 165,  # illustrative market reference INR/kg
    "prices": [163, 162, 161.5, 158, 154],
    "target": 170,
    "limit": 165,  # floor
    "reserves": [169, 167, 166, 163, 158],
    "payment_codes": ["ADV", "ZD30", "ZD30", "ZD45", "LC"],
    "delivery_days": [5, 7, 7, 10, 5],
    "incoterm": "EXW",
}


def hero_buy_positions() -> list[CartPosition]:
    cat = BUY_CATEGORIES[0]
    created = TODAY - timedelta(days=3)
    return [
        make_position(
            cart_no=HERO_BUY_CART, pos=row["position"], description=row["description"], cat=cat,
            unit=row["unit"], qty=row["qty"], price=row["ref"], created=created,
            order_for=("0800", "Plant Pune"), requestor="MRUNAL PAWAR", cost_centre="2176000",
        )
        for row in HERO_BUY_ITEMS
    ]
