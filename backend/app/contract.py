"""A sample contract document for a closed deal, built from the deal's outcome (demo data only).

One document per supplier of the event. The type follows the blueprint: a Purchase Order for goods, a Frame Contract for
services and a Scrap contract for scrap sales. The approvers follow the value-based chain in the Approval Matrix: up to
50 lakh the Section Head; 50 lakh to 1 crore also the Head BA; above 1 crore also the ED Procurement and the MD (for
scrap the top band is the ED only). The register, approvals and distribution themselves belong to AIS; this is the
document the deal produces.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, time, timedelta

from app import deal, ids
from app import schemas as sch
from app.readmodel import Snapshot
from app.services import NotFound

CRORE = 10_000_000.0
LAKH = 100_000.0

COMPANY_ADDRESS = "Plot No. 1, Chakan Industrial Area, Phase II, Pune, Maharashtra 410501, India"
COMPANY_GSTIN = "27AAACS0000A1Z5"
COMPANY_CIN = "U34100PN2000PTC000000"
VERSION = "1.0"

# Draft wording for the demo; the final text has to come from the Legal department.
CLAUSES_COMMON = [
    ("Definitions", "In this contract the Buyer and the Seller are the parties named above, the Goods or Services are what the schedule lists, and the Contract Value is the total of the schedule."),
    ("Scope and price", "The Seller delivers the Goods or Services in the schedule at the agreed price. The price is fixed for the validity of this contract and includes packing and forwarding unless the Incoterm says otherwise."),
    ("Delivery", "The Seller delivers to the delivery place by the delivery date, on the Incoterm stated above. Risk passes as the Incoterm provides."),
    ("Payment and taxes", "The Buyer pays on the payment terms above after receipt of a correct tax invoice and acceptance of the delivery. GST is charged as applicable and the Buyer deducts TDS as the law requires."),
    ("Liquidated damages", "Delay in delivery attracts liquidated damages at 0.5% of the value of the late part per week, capped at 5% of the Contract Value."),
    ("Warranty", "The Seller warrants the quality of what it delivers for the warranty period and replaces defective parts at its own cost."),
    ("Confidentiality", "Each party keeps the other's drawings, prices and business information confidential and uses them only for this contract."),
    ("Termination", "Either party may end this contract for a material breach that is not corrected within 30 days of written notice."),
    ("Governing law", "This contract is governed by the laws of India. Disputes go to the courts at Pune."),
]
CLAUSES_SCRAP = [
    ("Definitions", "In this contract the Seller owns the scrap, the Buyer lifts it, and the Contract Value is the total of the schedule."),
    ("Lifting", "The Buyer weighs and lifts the material at its own cost from the Seller's yard within the agreed days of this contract."),
    ("Payment and taxes", "Payment is made on the terms above before the material leaves the yard, unless the terms say otherwise. GST and TCS are charged as applicable."),
    ("Quantity", "The weighbridge reading at the Seller's yard decides the quantity; the Buyer may be present at the weighing."),
    ("Condition", "The Buyer takes the material as seen. Mixed or contaminated material is deducted at the rates agreed in advance."),
    ("Confidentiality", "Each party keeps the other's business information confidential."),
    ("Governing law", "This contract is governed by the laws of India. Disputes go to the courts at Pune."),
]


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    day = d.day
    while True:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1


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
        months = max((o.tenure_months or 0 for _, o in rows), default=0) or None
        ends = _add_months(last, months) if months else None
        no = f"CT-E1-{seq}{suffix}"
        approvals = [sch.ContractApproval(
            role=role, name=name, status="Approved", date=last + timedelta(days=n),
            esign_id="ESIGN-" + hashlib.sha1(f"{no}|{role}".encode()).hexdigest()[:10].upper(),
            signed_at=datetime.combine(last + timedelta(days=n), time(10 + n, 15)).isoformat())
            for n, (role, name) in enumerate(_approvers(total, scrap), start=1)]
        doc = sch.ContractDoc(
            contract_no=no, contract_type=ctype, request_no=event.id, date=last,
            title=event.title, direction=event.direction,
            buyer_name=event.company if not scrap else (vendor.name if vendor else vendor_id),
            buyer_detail=f"{event.plant} · {event.purch_org}",
            seller_name=(vendor.name if vendor else vendor_id) if not scrap else event.company,
            seller_detail=(f"SAP vendor no. {vendor.sap_no}" if vendor else "") if not scrap else f"{event.plant} · {event.purch_group}",
            requestor=event.requestor, cost_centre=event.cost_centre, cart_no=event.source_cart_no,
            payment_terms=payment, incoterm=incoterm, delivery_by=last + timedelta(days=longest),
            valid_until=ends if ends else last + timedelta(days=365 if ctype.startswith("Frame") else longest + 30),
            tenure_months=months, term_starts=last if months else None, term_ends=ends,
            renewal_reminder=ends - timedelta(days=90) if ends else None,
            items=[sch.ContractItem(
                position=i.position, description=i.description, qty=o.qty, unit=i.unit, unit_price=o.final_price,
                value=deal.value(o.qty, o.final_price), original_price=o.original_price) for i, o in rows],
            total_value=total, original_value=original, saved=deal.realised_delta(event.direction, original, total, 1.0),
            approvals=approvals, clauses=[sch.ContractClause(heading=h, text=t) for h, t in (CLAUSES_SCRAP if scrap else CLAUSES_COMMON)],
            company_address=COMPANY_ADDRESS, company_gstin=COMPANY_GSTIN, company_cin=COMPANY_CIN,
            version=VERSION, locked_at=approvals[-1].date, doc_hash="", distribution=[
                f"Copy uploaded to the contract register of {event.company}",
                f"Emailed to the requestor ({event.requestor}) and to {(vendor.name if vendor else vendor_id)}"])
        # The frozen content is hashed; any later change to the deal gives a different hash, so a stale copy shows up.
        doc.doc_hash = hashlib.sha256(doc.model_dump_json(exclude={"doc_hash"}).encode()).hexdigest()
        docs.append(doc)
    return docs
