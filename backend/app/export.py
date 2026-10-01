"""CSV exports of a closed event: the SAP Shopping Cart upload template (buy) and a deal summary (sell).

Money comes from the stored outcomes; nothing is recomputed here except the delivery date.
"""
from __future__ import annotations

import csv
import io
from datetime import timedelta

from app import deal, readmodel, services
from app.models import Event, Item, Outcome

# The template's 38 headers, exactly as in data/samples/shopping_cart_upload_template.csv.
TEMPLATE_COLUMNS = [
    "S.No.", "Company Code", "Shopping Cart No.", "Item Number", "Requestor", "Supplier ",
    "P.Org.\n( LPOS / PPMI)", "P.Grp.", "Purchase Order Name", "Globe Number",
    "Best Bid (considering all line items)", "Deemed Transaction", "Currency", "Invoice Recipient",
    "Payment Terms", "Incoterm Key", "Incoterm Location", "Product ID\n( Part Number )",
    "Product Category", "Description\n( not reqd. if Part Number is avl.)", "Qty.", "Unit",
    "Gross Price/Unit", "Delivery Date\n(DD.MM.YYYY)", "Validity Date", "Tax Code",
    "HSN / SAC Number", "Vendor Text ( Item)", "Vendor Text ( Appendix)",
    "Penalty Clause Information", "Add. Delivery date information", "Vendor Text ( Header)",
    "Warranty Period", "Ship - To Address", "Technical Contact Person",
    "Technical Contact Person Phone", "Internal Note", "Add. Payment term information",
]
assert len(TEMPLATE_COLUMNS) == 38

SUMMARY_COLUMNS = [
    "Event", "Item", "Description", "Buyer", "Qty", "Unit", "Original bid", "Final price", "Uplift",
    "Payment terms", "Closed date",
]

# Per-kind defaults for template columns the input data does not carry (assumption 94).
_TAX = {"service": ("5L", "9983")}


def _date(d) -> str:
    return d.strftime("%d.%m.%Y")


def _org(text: str) -> str:
    """LPOS or PPMI when the text names one, else the text as it is."""
    return next((k for k in ("LPOS", "PPMI") if k in text), text)


def _num(x: float) -> str:
    return f"{x:.2f}".rstrip("0").rstrip(".") if x != int(x) else str(int(x))


def _closed_outcomes(snap: readmodel.Snapshot, event: Event) -> list[tuple[Item, Outcome]]:
    out = []
    for item in sorted(snap.items_by_event[event.id], key=lambda i: i.position):
        o = snap.outcomes.get(item.id)
        if o is not None:
            out.append((item, o))
    return out


def export_event(snap: readmodel.Snapshot, event_id: str) -> tuple[str, str]:
    """(filename, csv text). Raises NotFound for an unknown event and Conflict until it is closed."""
    event = snap.event_by_id.get(event_id)
    if event is None:
        raise services.NotFound(f"event {event_id} not found")
    if readmodel.event_view(snap, event).status != "closed":
        raise services.Conflict("only a closed event can be exported")
    rows = _closed_outcomes(snap, event)
    if not rows:
        raise services.Conflict("this event closed without any deal, so there is nothing to export")
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    if event.direction == "buy":
        w.writerow(TEMPLATE_COLUMNS)
        for n, (item, o) in enumerate(rows, 1):
            vendor = snap.vendors[o.vendor_id]
            tax, hsn = _TAX.get(item.kind, ("", ""))
            note = (f"Negotiated from {_num(o.original_price)} to {_num(o.final_price)}" if o.negotiated
                    else "Best quote accepted as it stood")
            w.writerow([
                n, event.company_id, event.source_cart_no or "", item.position, event.requestor,
                vendor.sap_no, _org(event.purch_org), event.purch_group.split()[-1], event.title, "",
                1, "", "INR", "", o.payment_code, o.incoterm, "SAVWIPL", "",
                event.category.split(" - ")[0].strip(), item.description, _num(o.qty), item.unit,
                _num(o.final_price), _date(o.closed_date + timedelta(days=item.delivery_days)), "", tax, hsn,
                "", "", "", "", "", "", "", "", "", note, ""])
        name = f"shopping_cart_template_{event.id}.csv"
    else:
        w.writerow(SUMMARY_COLUMNS)
        for item, o in rows:
            vendor = snap.vendors[o.vendor_id]
            w.writerow([event.id, item.position, item.description, vendor.name, _num(o.qty), item.unit,
                        _num(o.original_price), _num(o.final_price),
                        _num(deal.realised_delta(o.direction, o.original_price, o.final_price, o.qty)),
                        o.payment_code, _date(o.closed_date)])
        name = f"deal_summary_{event.id}.csv"
    return name, "﻿" + buf.getvalue()
