from __future__ import annotations

import random

from app.models import Vendor
from app.seed.catalog import BUY_CATEGORIES, FAMILIES

_FIRST = ("Sahyadri", "Deccan", "Konkan", "Vidarbha", "Malwa", "Kaveri", "Godavari", "Narmada",
          "Bharat", "Shivneri", "Rajgad", "Pratap", "Gomti", "Tapi", "Indrayani")
_SECOND = ("Caterers", "Hospitality", "Office Systems", "Stationers", "Facility Services",
           "Printers", "Logistics", "Learning", "Industrial Supplies", "Events")
_FORM = ("Pvt Ltd", "Enterprises", "& Co")
_SCRAP_BUYERS = (
    "Sahyadri Metal Recyclers", "Deccan Alloys Traders", "Konkan Scrap Industries",
    "Vidarbha Smelters", "Malwa Metals Pvt Ltd", "Kaveri Reclaim Works",
    "Godavari Eco Recyclers", "Narmada Ewaste Solutions", "Bharat Steel Scrap Co",
    "Shivneri Polymers Recycling", "Rajgad Oil Refiners", "Pratap Paper Mills Scrap Desk",
    "Gomti Rubber Reclaim", "Tapi Wood And Pallet Traders", "Indrayani Metals Exchange",
    "Pune Circular Materials",
)


def build_vendors(rng: random.Random) -> list[Vendor]:
    vendors: list[Vendor] = []
    for i in range(30):
        vendors.append(Vendor(
            id=f"V{i + 1:03d}",
            name=f"{_FIRST[i % 15]} {_SECOND[i % 10]} {_FORM[i % 3]}",
            sap_no=str(3300100000 + i * 137),
            type="supplier",
            categories=[BUY_CATEGORIES[i % 10].code, BUY_CATEGORIES[(i + 3) % 10].code],
            rating=round(3.2 + rng.random() * 1.7, 1),
            payment_pref=rng.choice(["ZD30", "ZD45", "ZD60"]),
            past_deals=rng.randint(3, 60),
        ))
    for j, name in enumerate(_SCRAP_BUYERS):
        cats = sorted({FAMILIES[(j + k) % 12] for k in (0, 1, 5, 7)})
        vendors.append(Vendor(
            id=f"V{31 + j:03d}",
            name=name,
            sap_no=str(3300100000 + (30 + j) * 137),
            type="scrap_buyer",
            categories=cats,
            rating=round(3.0 + rng.random() * 1.8, 1),
            payment_pref=rng.choice(["ADV", "ZD15", "ZD30", "LC"]),
            past_deals=rng.randint(3, 80),
        ))
    return vendors


def pool(vendors: list[Vendor], category_key: str) -> list[Vendor]:
    return sorted((v for v in vendors if category_key in v.categories), key=lambda v: v.id)
