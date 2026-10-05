"""A sample contract document for a closed deal, built from the deal's outcome (demo data only).

One document per supplier of the event. The type follows the blueprint: a Purchase Order for goods, a Frame Contract for
services and a Scrap contract for scrap sales. The approvers follow the value-based chain in the Approval Matrix: up to
50 lakh the Section Head; 50 lakh to 1 crore also the Head BA; above 1 crore also the ED Procurement and the MD (for
scrap the top band is the ED only). The register, approvals and distribution themselves belong to AIS; this is the
document the deal produces.
"""
from __future__ import annotations

import re
from datetime import timedelta

from app import deal, ids
from app import schemas as sch
from app.readmodel import Snapshot
from app.services import NotFound

CRORE = 10_000_000.0
LAKH = 100_000.0

TERMS_COMMON = [
    "The supplier delivers the goods or services described in the schedule at the agreed price, at the delivery place and by the delivery date.",
    "Payment is made on the terms in this document, after receipt of a correct invoice and acceptance of the delivery.",
    "Delay in delivery attracts liquidated damages at 0.5% of the value of the late part per week, capped at 5% of the contract value.",
    "The supplier warrants the quality of what it delivers for the warranty period and replaces defective parts at its own cost.",
    "Either party may end this contract for a material breach that is not corrected within 30 days of written notice.",
    "This contract is governed by the laws of India. Disputes go to the courts at Pune.",
]
TERMS_SCRAP = [
    "The buyer weighs and lifts the material at its own cost from the seller's yard, within the agreed days of this contract.",
    "Payment is made on the terms in this document before the material leaves the yard, unless the terms say otherwise.",
    "The weighbridge reading at the seller's yard decides the quantity; the buyer may be present at the weighing.",
    "The buyer takes the material as seen. Mixed or contaminated material is deducted at the rates agreed in advance.",
    "This contract is governed by the laws of India. Disputes go to the courts at Pune.",
]


def _approvers(value_inr: float, scrap: bool) -> list[tuple[str, str]]:
    chain = [("Section Head BA", "Section Head BA Persona E1")]
    if value_inr > 50 * LAKH:
        chain.append(("Head BA", "Head BA Persona E1"))
    if value_inr > CRORE:
        chain.append(("ED Procurement", "ED Procurement Persona E1"))
        if not scrap:
            chain.append(("Managing Director", "MD Persona E1"))
    return chain


def contract_docs(snap: Snapshot, event_id: str) -> list[sch.ContractDoc]:
    event = snap.event_by_id.get(event_id)
    if event is None:
        raise NotFound(f"event {event_id} not found")
    items = sorted(snap.items_by_event[event_id], key=lambda i: i.position)
    closed = [(i, snap.outcomes[i.id]) for i in items if i.id in snap.outcomes]
    if not closed:
        raise NotFound("this event has no closed deal yet, so there is no contract to show")
    by_vendor: dict[str, list] = {}
    for i, o in closed:
        by_vendor.setdefault(o.vendor_id, []).append((i, o))
    seq = re.sub(r"\D", "", event.id)[-5:].zfill(5)
    scrap = event.direction == "sell"
    docs = []
    for k, (vendor_id, rows) in enumerate(sorted(by_vendor.items()), start=1):
        vendor = snap.vendors.get(vendor_id)
        last = max(o.closed_date for _, o in rows)
        total = sum(deal.value(o.qty, o.final_price) for _, o in rows)
        original = sum(deal.value(o.qty, o.original_price) for _, o in rows)
        suffix = "" if len(by_vendor) == 1 else f"-{chr(64 + k)}"
        kinds = {i.kind for i, _ in rows}
        ctype = "Scrap contract" if scrap else ("Frame Contract (FC)" if "service" in kinds else "Purchase Order (PO)")
        payment = rows[0][1].payment_code
        incoterm = rows[0][1].incoterm
        longest = max(i.delivery_days for i, _ in rows)
        approvals = [sch.ContractApproval(
            role=role, name=name, status="Approved", date=last + timedelta(days=n))
            for n, (role, name) in enumerate(_approvers(total, scrap), start=1)]
        docs.append(sch.ContractDoc(
            contract_no=f"CT-E1-{seq}{suffix}", contract_type=ctype, request_no=event.id, date=last,
            title=event.title, direction=event.direction,
            buyer_name=event.company if not scrap else (vendor.name if vendor else vendor_id),
            buyer_detail=f"{event.plant} · {event.purch_org}",
            seller_name=(vendor.name if vendor else vendor_id) if not scrap else event.company,
            seller_detail=(f"SAP vendor no. {vendor.sap_no}" if vendor else "") if not scrap else f"{event.plant} · {event.purch_group}",
            requestor=event.requestor, cost_centre=event.cost_centre, cart_no=event.source_cart_no,
            payment_terms=payment, incoterm=incoterm, delivery_by=last + timedelta(days=longest),
            valid_until=last + timedelta(days=365) if ctype.startswith("Frame") else None,
            items=[sch.ContractItem(
                position=i.position, description=i.description, qty=o.qty, unit=i.unit, unit_price=o.final_price,
                value=deal.value(o.qty, o.final_price), original_price=o.original_price) for i, o in rows],
            total_value=total, original_value=original, saved=deal.realised_delta(event.direction, original, total, 1.0),
            approvals=approvals, terms=TERMS_SCRAP if scrap else TERMS_COMMON, distribution=[
                f"Copy uploaded to the contract register of {event.company}",
                f"Emailed to the requestor ({event.requestor}) and to {(vendor.name if vendor else vendor_id)}"]))
    return docs
