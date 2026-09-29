from __future__ import annotations

import random
from datetime import date, timedelta

from app.importer import CartPosition
from app.seed.catalog import BUY_CATEGORIES, REQUESTORS, BuyCategory
from app.seed.constants import EUR_RATE, TODAY

OVERSIZE_CARTS = {7, 23, 41}
TINY_CART = 15
_VW_DIGITAL = ("9790", "Volkswagen Group Digital Sol Pvt Ltd")
_PUNE = ("0800", "Plant Pune")


def make_position(
    *, cart_no: str, pos: int, description: str, cat: BuyCategory, unit: str, qty: int,
    price: int, created: date, order_for: tuple[str, str], requestor: str, cost_centre: str,
) -> CartPosition:
    approval = created + timedelta(days=2)
    delivery_from = approval + timedelta(days=5)
    delivery_to = delivery_from + timedelta(days=25)
    inr_value = float(qty * price)
    eur_value = float(round(inr_value / EUR_RATE))
    lpos = order_for[0] == "0800"
    return CartPosition(
        cart_no=cart_no, pos=pos, description=description, company_id="0800",
        company="SKODA Auto VW India", order_for_id=order_for[0], order_for=order_for[1],
        purch_org="Purchasing Organisation LPOS (SAVWIPL)" if lpos else "Purchase Organisation LPOS",
        purch_group=f"Purchasing Group {cat.short}", purch_group_short=cat.short,
        eclass=cat.eclass, create_date=created, approval_date=approval,
        delivery_from=delivery_from, delivery_to=delivery_to, requestor=requestor,
        req_cost_centre=cost_centre, cost_centre=cost_centre, account_assignment="ZCC",
        value_type="CTM (<10k €)" if eur_value < 10000 else "Standard (>=10k €)",
        price_unit=1, qty_unit=unit, currency="INR", ageing_days=(TODAY - created).days,
        qty=float(qty), eur_unit_price=round(price / EUR_RATE, 2), eur_value=eur_value,
        inr_unit_price=float(price), inr_value=inr_value, status="Open" if pos == 1 else "",
    )


def make_cart_positions(rng: random.Random) -> list[CartPosition]:
    out: list[CartPosition] = []
    for c in range(59):
        cart_no = str(1012360000 + c * 53)
        created = TODAY - timedelta(days=30 + (c * 11) % 150)
        order_for = _VW_DIGITAL if c % 6 == 5 else _PUNE
        requestor = rng.choice(REQUESTORS)
        cost_centre = str(2170000 + 1000 * rng.randint(0, 12))
        cat = BUY_CATEGORIES[4 if c == TINY_CART else c % 10]
        if c == TINY_CART:
            picks = [(cat.templates[2], 40, 25)]
        else:
            n_pos = min(2 + c % 3, len(cat.templates))
            picks = []
            for t in rng.sample(cat.templates, n_pos):
                picks.append((t, rng.randint(t.qty_lo, t.qty_hi), rng.randint(t.price_lo, t.price_hi)))
            if c in OVERSIZE_CARTS:
                t, _, price = picks[0]
                picks[0] = (t, -(-1_100_000 // price), price)
        for pos, (t, qty, price) in enumerate(picks, start=1):
            out.append(make_position(
                cart_no=cart_no, pos=pos, description=t.description, cat=cat, unit=t.unit,
                qty=qty, price=price, created=created, order_for=order_for,
                requestor=requestor, cost_centre=cost_centre,
            ))
    return out
