"""Create an event from a buyer's own input (as opposed to the generated sample in app.simulate).

The buyer supplies the event details, the items and the vendors to invite. The vendors' answers are still
simulated: each invited vendor gets a scripted quote or bid built from the item's reference price, which
the buyer "collects" later, exactly as for the seeded events.
"""
from __future__ import annotations

import random
import re
from datetime import date, timedelta
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import clock, eligibility
from app.models import Direction, Event, Unit
from app.seed.build import Accumulator, _add_item
from app.seed.catalog import BUY_CATEGORIES, FAMILY_TITLES, REQUESTORS, SCRAP_MATERIALS
from app.seed.constants import SEED
from app.seed.vendors import pool
from app.services import Conflict
from app.store import Repo

MIN_VENDORS = 3
MAX_ITEMS = 20
INCOTERMS = ("FH", "EXW", "FCA", "DAP", "DDP")
_SERVICE_CODES = {"25200000", "41120214", "90101500", "82121500", "78101800", "86101700"}


class NewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=2, max_length=120)
    qty: float = Field(gt=0, le=10_000_000)
    unit: Unit
    reference_price: float = Field(gt=0, le=100_000_000)
    incoterm: Optional[str] = None
    delivery_days: Optional[int] = Field(default=None, ge=0, le=365)

    @field_validator("description")
    @classmethod
    def _trim(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("describe the item")
        return v


class NewEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Direction
    title: Optional[str] = Field(default=None, max_length=120)
    category_key: str  # a key from the options, or "custom" together with category_label
    category_label: Optional[str] = Field(default=None, max_length=60)
    company_id: str
    company: str
    plant: str
    purch_org: str
    purch_group: str
    requestor: str = Field(min_length=2, max_length=60)
    cost_centre: str = Field(min_length=3, max_length=20)
    due: date
    source_cart_no: Optional[str] = Field(default=None, max_length=20)
    vendor_ids: list[str]
    items: list[NewItem] = Field(min_length=1, max_length=MAX_ITEMS)


def options(repo: Repo) -> dict:
    """What the Add event form offers: categories with their vendor pools, and values seen on existing events."""
    vendors = repo.fetch("vendor")

    def pool_view(key: str) -> list[dict]:
        return [{"id": v.id, "name": v.name, "rating": v.rating, "language": "en"} for v in pool(vendors, key)]

    buy = [{
        "key": c.code, "label": c.eclass, "direction": "buy", "kind": c.kind,
        "samples": [{"description": t.description, "unit": t.unit, "qty": t.qty_lo, "reference_price": t.price_lo}
                    for t in c.templates],
        "vendors": pool_view(c.code),
    } for c in BUY_CATEGORIES]
    seen: set[str] = set()
    sell = []
    for m in SCRAP_MATERIALS:
        if m.family in seen:
            continue
        seen.add(m.family)
        mats = [x for x in SCRAP_MATERIALS if x.family == m.family]
        sell.append({
            "key": m.family, "label": f"Scrap - {FAMILY_TITLES[m.family]}", "direction": "sell", "kind": "scrap",
            "samples": [{"description": x.description, "unit": "KG", "qty": 1000, "reference_price": x.price_lo}
                        for x in mats],
            "vendors": pool_view(m.family),
        })
    orgs: dict[tuple, dict] = {}
    for e in repo.fetch("event"):
        key = (e.direction, e.company_id, e.plant, e.purch_org, e.purch_group)
        orgs.setdefault(key, {"direction": e.direction, "company_id": e.company_id, "company": e.company,
                              "plant": e.plant, "purch_org": e.purch_org, "purch_group": e.purch_group,
                              "cost_centre": e.cost_centre})
    return {
        "categories": buy + sell,
        "organisations": list(orgs.values()),
        "requestors": list(REQUESTORS),
        "incoterms": list(INCOTERMS),
        "min_vendors": MIN_VENDORS,
    }


RECOMMENDED = 5  # how many vendors are suggested by default


def custom_category(repo: Repo, direction: str, label: str) -> dict:
    """A category the buyer typed in. With no history behind it, every vendor of the right kind can be invited."""
    label = " ".join((label or "").split())
    if len(label) < 2:
        raise Conflict("give the new category a name")
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "other"
    kind = "supplier" if direction == "buy" else "scrap_buyer"
    pool_ = sorted((v for v in repo.fetch("vendor") if v.type == kind), key=lambda v: v.id)
    return {
        "key": f"custom_{slug}", "label": f"Scrap - {label}" if direction == "sell" else f"Custom - {label}",
        "direction": direction, "kind": "scrap" if direction == "sell" else "goods", "samples": [],
        "vendors": [{"id": v.id, "name": v.name, "rating": v.rating, "language": "en"} for v in pool_],
    }


def _category(repo: Repo, direction: str, key: str, label: Optional[str]) -> dict:
    if key == "custom":
        return custom_category(repo, direction, label or "")
    found = next((c for c in options(repo)["categories"] if c["key"] == key and c["direction"] == direction), None)
    if found is None:
        raise Conflict("choose a category that matches the event type")
    return found


def suggest_vendors(repo: Repo, direction: str, category_key: str, descriptions: list[str],
                    category_label: Optional[str] = None) -> list[dict]:
    """Rank the vendors of a category for a request, best first, each with the reasons it was suggested.

    A vendor scores for its rating, how much it has done with us, past deals on the same items or the same
    category, and how it has negotiated before (flexible helps, hard to move counts against).
    """
    from app import readmodel

    category = _category(repo, direction, category_key, category_label)
    category_key = category["key"]
    vendors = {v.id: v for v in repo.fetch("vendor")}
    history = repo.fetch("history")
    wanted = [d.strip().lower() for d in descriptions if d and d.strip()]
    ranked = []
    for row in category["vendors"]:
        v = vendors[row["id"]]
        mine = [h for h in history if h.vendor_id == v.id]
        same_item = [h for h in mine if any(w in h.description.lower() or h.description.lower() in w for w in wanted)]
        same_category = [h for h in mine if h.category_key == category_key]
        tough = readmodel.vendor_toughness(history, v.id)
        score = v.rating * 10 + min(v.past_deals, 40) / 4 + 6 * min(len(same_item), 3) + 2 * min(len(same_category), 5)
        score += {"flexible": 5, "firm": 2, "hard": -6, "unknown": 0}[tough.level]
        reasons = []
        if same_item:
            reasons.append(f"Dealt on {'this item' if len(wanted) == 1 else 'similar items'} {len(same_item)} time{'s' if len(same_item) != 1 else ''} before")
        if same_category:
            reasons.append(f"{len(same_category)} past deal{'s' if len(same_category) != 1 else ''} in this category")
        if v.rating >= 4.5:
            reasons.append(f"Top rated ({v.rating:.1f})")
        elif v.rating >= 4.0:
            reasons.append(f"Well rated ({v.rating:.1f})")
        if v.past_deals >= 30:
            reasons.append(f"{v.past_deals} deals with us")
        if tough.level == "flexible":
            reasons.append("Flexible when negotiating")
        elif tough.level == "hard":
            reasons.append("Hard to crack: keep as a back-up")
        ranked.append({"id": v.id, "name": v.name, "rating": v.rating, "past_deals": v.past_deals,
                       "score": round(score, 1), "reasons": reasons[:4], "toughness": tough.level})
    ranked.sort(key=lambda r: (-r["score"], r["id"]))
    top = max(MIN_VENDORS, min(RECOMMENDED, len(ranked)))
    for i, r in enumerate(ranked):
        r["recommended"] = i < top
    return ranked


def _next_number(repo: Repo) -> int:
    return max(int(e.id.rsplit("-", 1)[1]) for e in repo.fetch("event")) + 1


def create_event(repo: Repo, body: NewEvent) -> str:
    """Store the event, its items and the vendors' scripted answers; returns the new event id."""
    vendors = repo.fetch("vendor")
    chosen = [v for v in vendors if v.id in set(body.vendor_ids)]
    if len(chosen) != len(set(body.vendor_ids)):
        raise Conflict("one of the selected vendors does not exist")
    category = _category(repo, body.direction, body.category_key, body.category_label)
    category_key = category["key"]
    allowed = {v["id"] for v in category["vendors"]}
    if not set(body.vendor_ids) <= allowed:
        raise Conflict("every invited vendor must deal in the chosen category")
    if len(chosen) < MIN_VENDORS:
        raise Conflict(f"invite at least {MIN_VENDORS} vendors so there are enough quotes to compare")
    if body.direction == "sell" and (len(body.items) != 1 or body.items[0].unit not in ("KG", "TON")):
        raise Conflict("a scrap lot is one item measured in KG or TON")
    if body.direction == "buy" and any(i.unit in ("KG", "TON") for i in body.items):
        raise Conflict("purchase items are counted in units, not weight")
    if body.due < clock.today():
        raise Conflict("the due date cannot be in the past")

    n = _next_number(repo)
    event_id = f"EVT-2026-{n:03d}"
    rng = random.Random(SEED + 5000 + n)
    today = clock.today()
    title = (body.title or "").strip() or (
        body.items[0].description + (f" (+{len(body.items) - 1} more)" if len(body.items) > 1 else ""))
    event = Event(
        id=event_id, type="shopping_cart" if body.direction == "buy" else "scrap_sale", direction=body.direction,
        title=title, company_id=body.company_id, company=body.company, plant=body.plant,
        purch_org=body.purch_org, purch_group=body.purch_group,
        category=category["label"], category_key=category_key, requestor=body.requestor.strip().upper(),
        cost_centre=body.cost_centre.strip(), created=today, approval_date=today, due=body.due,
        source_cart_no=((body.source_cart_no or "").strip() or (f"10124{n:05d}" if body.direction == "buy" else None)),
        hero=False, acceptable=False, no_deal=False, stage="draft",
    )
    acc = Accumulator()
    acc.events.append(event)
    if body.category_key == "custom":  # the vendor pool is chosen by hand, so the copies used to build bids carry the key
        chosen = [v.model_copy(update={"categories": [*v.categories, category_key]}) for v in chosen]
    kind_default = category["kind"]
    for idx, it in enumerate(body.items, start=1):
        kind = "scrap" if body.direction == "sell" else (
            "service" if it.unit == "AU" or category_key in _SERVICE_CODES else kind_default)
        _add_item(rng, chosen, event, idx, len(body.items), desc=it.description, kind=kind, qty=float(it.qty),
                  unit=it.unit, ref=float(it.reference_price),
                  incoterm=it.incoterm or ("EXW" if body.direction == "sell" else "FH"),
                  delivery_days=it.delivery_days if it.delivery_days is not None else (7 if body.direction == "sell" else 14),
                  acc=acc)
    with repo.transaction():
        repo.put("event", event.id, event)
        for i in acc.items:
            repo.put("item", i.id, i, parent=i.event_id)
        for b in acc.scripted:
            repo.put("scripted_bid", b.id, b, parent=b.item_id)
        for bid_id, value in acc.reserves.items():
            repo.put("reserve", bid_id, value)
    return event_id
