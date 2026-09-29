"""Parser and renderer for the SAP "Open Shopping Cart Report" (30 columns, cp1252)."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

RAW_HEADERS = (
    "Shopping cart", "Shopping cart pos", "SC description", "Company ID ", "Company ",
    "ID Company (order for)", "Company (order for)", "Purchasing organisation",
    "Purchasing group", "Purch group short", "eCl@ss", "SC create date", "SC approval date ",
    "Delivery from", "Delivery to", "Requestor", "Requesting cost centre",
    "Cost center to be charged", "Account assignment", "SC value type", "SC price unit",
    "SC quantity unit en", "SC currency", "Avg. SC ageing ", "SC quantity ",
    "Avg. SC net price per unit in EUR", "SC value in EUR ",
    "Avg. SC net price per unit in currency", "SC value in currency ", "Status",
)
COLUMNS = tuple(h.strip() for h in RAW_HEADERS)


@dataclass(frozen=True)
class CartPosition:
    cart_no: str
    pos: int
    description: str
    company_id: str
    company: str
    order_for_id: str
    order_for: str
    purch_org: str
    purch_group: str
    purch_group_short: str
    eclass: str
    create_date: date
    approval_date: date
    delivery_from: date
    delivery_to: date
    requestor: str
    req_cost_centre: str
    cost_centre: str
    account_assignment: str
    value_type: str
    price_unit: int
    qty_unit: str
    currency: str
    ageing_days: int
    qty: float
    eur_unit_price: float
    eur_value: float
    inr_unit_price: float
    inr_value: float
    status: str

    @property
    def eclass_code(self) -> str:
        return self.eclass.split(" - ", 1)[0].strip()

    @property
    def eclass_name(self) -> str:
        parts = self.eclass.split(" - ", 1)
        return parts[1].strip() if len(parts) == 2 else ""

    @property
    def shifted(self) -> bool:
        """Quantity column holds the money value and unit price collapsed to 1 (the meal rows)."""
        return self.inr_unit_price == 1 and self.inr_value > 1 and self.qty == self.inr_value

    @property
    def net_qty(self) -> float:
        return 1.0 if self.shifted else self.qty

    @property
    def net_unit_price(self) -> float:
        return self.inr_value if self.shifted else self.inr_unit_price


@dataclass(frozen=True)
class RowWarning:
    row: int
    cart_no: str
    pos: int
    kind: str
    message: str


@dataclass(frozen=True)
class ParseResult:
    positions: list[CartPosition]
    warnings: list[RowWarning]


def _num(s: str) -> float:
    s = s.replace(",", "").strip()
    return float(s) if s else 0.0


def _us_date(s: str) -> date:
    return datetime.strptime(s.strip(), "%m/%d/%Y").date()


def _approval_date(s: str) -> date:
    for fmt in ("%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unreadable approval date {s!r}")


def _warnings_for(row: int, p: CartPosition) -> list[RowWarning]:
    out: list[RowWarning] = []

    def add(kind: str, msg: str) -> None:
        out.append(RowWarning(row, p.cart_no, p.pos, kind, msg))

    if p.shifted:
        add("shifted_qty", "quantity column holds the value; treated as qty 1 at the full value")
    elif p.inr_unit_price not in (0, 1) and p.qty > 0:
        if abs(p.qty * p.inr_unit_price - p.inr_value) > max(1.0, 0.01 * p.inr_value):
            add("value_mismatch", "qty x INR unit price differs from INR value")
    if p.approval_date < p.create_date:
        add("date_order", "approval date is before create date")
    return out


def parse_text(text: str) -> ParseResult:
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header is None or tuple(h.strip() for h in header) != COLUMNS:
        raise ValueError("unexpected header: not an Open Shopping Cart Report")
    positions: list[CartPosition] = []
    warnings: list[RowWarning] = []
    cart = ""
    for n, row in enumerate(reader, start=2):
        if not any(c.strip() for c in row):
            continue
        if len(row) != len(COLUMNS):
            raise ValueError(f"row {n}: expected {len(COLUMNS)} columns, got {len(row)}")
        c = dict(zip(COLUMNS, (x.strip() for x in row)))
        if c["Shopping cart"]:
            cart = c["Shopping cart"]
        p = CartPosition(
            cart_no=cart,
            pos=int(_num(c["Shopping cart pos"])),
            description=c["SC description"],
            company_id=c["Company ID"],
            company=c["Company"],
            order_for_id=c["ID Company (order for)"],
            order_for=c["Company (order for)"],
            purch_org=c["Purchasing organisation"],
            purch_group=c["Purchasing group"],
            purch_group_short=c["Purch group short"],
            eclass=c["eCl@ss"],
            create_date=_us_date(c["SC create date"]),
            approval_date=_approval_date(c["SC approval date"]),
            delivery_from=_us_date(c["Delivery from"]),
            delivery_to=_us_date(c["Delivery to"]),
            requestor=c["Requestor"],
            req_cost_centre=c["Requesting cost centre"],
            cost_centre=c["Cost center to be charged"],
            account_assignment=c["Account assignment"],
            value_type=c["SC value type"],
            price_unit=int(_num(c["SC price unit"])),
            qty_unit=c["SC quantity unit en"],
            currency=c["SC currency"],
            ageing_days=int(_num(c["Avg. SC ageing"])),
            qty=_num(c["SC quantity"]),
            eur_unit_price=_num(c["Avg. SC net price per unit in EUR"]),
            eur_value=_num(c["SC value in EUR"]),
            inr_unit_price=_num(c["Avg. SC net price per unit in currency"]),
            inr_value=_num(c["SC value in currency"]),
            status=c["Status"],
        )
        positions.append(p)
        warnings.extend(_warnings_for(n, p))
    return ParseResult(positions, warnings)


def parse_report(path: str | Path) -> ParseResult:
    return parse_text(Path(path).read_bytes().decode("cp1252"))


def _fmt_num(v: float) -> str:
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.2f}"


def _us(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def _dm(d: date) -> str:
    return f"{d.day}/{d.month}/{d.year}"


def render_report(positions: list[CartPosition]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(RAW_HEADERS)
    last = None
    for p in positions:
        w.writerow([
            p.cart_no if p.cart_no != last else "", p.pos, p.description, p.company_id,
            p.company, p.order_for_id, p.order_for, p.purch_org, p.purch_group,
            p.purch_group_short, p.eclass, _us(p.create_date), _dm(p.approval_date),
            _us(p.delivery_from), _us(p.delivery_to), p.requestor, p.req_cost_centre,
            p.cost_centre, p.account_assignment, p.value_type, p.price_unit, p.qty_unit,
            p.currency, p.ageing_days, _fmt_num(p.qty), _fmt_num(p.eur_unit_price),
            _fmt_num(p.eur_value), _fmt_num(p.inr_unit_price), _fmt_num(p.inr_value), p.status,
        ])
        last = p.cart_no
    return buf.getvalue()


def write_report(positions: list[CartPosition], path: str | Path) -> None:
    Path(path).write_bytes(render_report(positions).encode("cp1252"))
