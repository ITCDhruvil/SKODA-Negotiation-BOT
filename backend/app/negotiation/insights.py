"""Private notes for the buyer, shown next to a vendor's reply: where that vendor stands against the other quotes,
what its terms are really worth, what its history says, how it is behaving and when a deal is within reach.

Everything here is worked out from the buyer's own data (the other vendors' quotes, past deals, the limit and
target). Notes are stored with the vendor's turn and never reach the vendor. At most one note is chosen per round,
and a kind is not repeated within two rounds, so the thread does not fill with advice.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app import deal
from app.models import Bid, Insight
from app.negotiation.messages import money

TOKEN_NOTE_AT = 2  # token steps in a row before the crawl note appears


@dataclass(frozen=True)
class Round:
    """What happened in this round, as the notes need it."""
    direction: str
    vendor_name: str
    qty: float
    original_price: float
    original_payment: str
    price: float  # the vendor's price after this reply
    previous_price: float
    payment: str
    round_no: int  # vendor replies so far, including this one
    stalls: int
    tokens: int
    mood: int
    flavour: str
    kind: str  # accept | counter | hold | firm
    ended: bool
    final: bool
    target: float
    limit: float
    own_bid: Bid
    others: list[tuple[str, Bid]]  # (vendor name, that vendor's quote)
    toughness_pct: Optional[float]  # average past movement, in %
    toughness_deals: int
    recent: tuple[str, ...]  # the kinds of the last two notes, oldest first


def _eff(d: str, price: float, payment: str, bid: Bid) -> float:
    return deal.effective_price(d, price, payment_code=payment, incoterm=bid.incoterm,
                                delivery_days=bid.delivery_days, warranty_months=bid.warranty_months)


def _ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def _candidates(r: Round) -> list[Insight]:
    d, v = r.direction, r.vendor_name
    gain_word = "Savings" if d == "buy" else "Uplift"
    out: list[Insight] = []
    best_other = deal.best_first(d, r.others, key=lambda o: o[1].unit_price)[0] if r.others else None

    # the vendor has left
    if r.ended:
        alt = f" The next-best quote is {best_other[0]} at {money(best_other[1].unit_price)}." if best_other else ""
        out.append(Insight(kind="left", tone="warn", text=f"{v} ended the conversation at {money(r.price)}.{alt}"))

    # a price inside the limit, or a deal agreed
    inside = deal.within_limit(d, r.price, r.limit)
    was_inside = deal.within_limit(d, r.previous_price, r.limit)
    if inside and (not was_inside or r.kind == "accept" or r.final):
        won = deal.realised_delta(d, r.original_price, r.price, r.qty)
        short = deal.gap_to_target(d, r.price, r.target)
        more = (f" Your target is {money(r.target)}, so pushing could add about {money(short * r.qty)}; "
                "accepting now is also fine." if short > 0 else " This already meets your target.")
        out.append(Insight(kind="checkpoint", tone="good",
                           text=f"{money(r.price)} is within your limit. {gain_word} if accepted: {money(won)}.{more}"))

    # behaviour: ultimatum, impatience
    if r.flavour == "ultimatum":
        out.append(Insight(kind="mood", tone="warn", text=(
            f"{v} called {money(r.price)} its final price. A first \"final\" is often tested once; "
            "if it is repeated after you hold, treat it as real.")))
    elif r.mood >= 75:
        out.append(Insight(kind="mood", tone="warn", text=(
            f"{v} is close to walking away. Make the next move a real step, or move to another quote.")))
    elif r.mood >= 50:
        out.append(Insight(kind="mood", tone="warn", text=(
            f"{v} is getting impatient. A real step now will do more than another small one.")))

    # tiny moves in a row
    if r.tokens >= TOKEN_NOTE_AT:
        step = abs(r.price - r.previous_price)
        out.append(Insight(kind="crawl", tone="warn", text=(
            f"{v} has moved by token amounts {r.tokens} replies in a row (latest step {money(step)}). "
            "That is stalling, not movement: trade terms or split the difference next.")))

    # history against what has happened so far
    if r.toughness_pct is not None and r.toughness_deals >= 2 and r.round_no >= 2:
        moved = abs(r.price - r.original_price) / r.original_price * 100 if r.original_price else 0.0
        if moved >= r.toughness_pct:
            text = (f"In {r.toughness_deals} past negotiated deals {v} moved the price {r.toughness_pct}% on average; "
                    f"it has already moved {moved:.1f}% here, so there may be little left to gain on price.")
        else:
            text = (f"In {r.toughness_deals} past negotiated deals {v} moved the price {r.toughness_pct}% on average; "
                    f"it has moved {moved:.1f}% so far, so some room is likely left.")
        out.append(Insight(kind="history", tone="info", text=text))

    # terms worth more or less than they look
    if r.others:
        mine = _eff(d, r.price, r.payment, r.own_bid)
        pool = [(v, mine, r.price, r.payment)] + [
            (n, _eff(d, b.unit_price, b.payment_code, b), b.unit_price, b.payment_code) for n, b in r.others]
        by_eff = deal.best_first(d, pool, key=lambda x: x[1])
        by_raw = deal.best_first(d, pool, key=lambda x: x[2])
        if by_eff[0][0] != by_raw[0][0]:
            ne, nr = by_eff[0], by_raw[0]
            if ne[0] == v:
                text = (f"After terms are counted, {v} is the best offer: {money(r.price)} on {r.payment} comes to "
                        f"{money(mine)}, ahead of {nr[0]} at {money(nr[2])} on {nr[3]} ({money(nr[1])}).")
            else:
                text = (f"After terms are counted, {ne[0]} is the best offer: {money(ne[2])} on {ne[3]} comes to "
                        f"{money(ne[1])}, while {v}'s {money(r.price)} on {r.payment} comes to {money(mine)}.")
            out.append(Insight(kind="terms", tone="info", text=text))

    # gap to the best other quote
    if best_other:
        alt_name, alt_bid = best_other
        better = deal.is_better(d, r.price, alt_bid.unit_price)
        gap = deal.distance(r.price, alt_bid.unit_price)
        if better and gap > 0:
            out.append(Insight(kind="alternative", tone="good",
                               text=f"{v} is now {money(gap)} better than every other quote (next: {alt_name} at {money(alt_bid.unit_price)})."))
        elif gap > 0:
            hold = " If it stops moving, switching is a real option." if r.stalls >= 1 else ""
            out.append(Insight(kind="alternative", tone="warn" if r.stalls >= 1 else "info",
                               text=f"{v} is {money(gap)} worse than the next-best quote ({alt_name} at {money(alt_bid.unit_price)}).{hold}"))

    # where the vendor stands on price
    if r.others:
        pool = [(v, r.price)] + [(n, b.unit_price) for n, b in r.others]
        order = deal.best_first(d, pool, key=lambda x: x[1])
        rank = [n for n, _ in order].index(v) + 1
        rest = ", ".join(f"{n} {money(p)}" for n, p in order if n != v)
        out.append(Insight(kind="position", tone="good" if rank == 1 else "info",
                           text=f"{v} is at {money(r.price)}, {_ordinal(rank)} of {len(pool)} on price. Other quotes: {rest}."))
    return out


def pick(r: Round) -> list[Insight]:
    """The one note for this round: the most useful kind that has not been shown in the last two notes."""
    for note in _candidates(r):
        if note.kind not in r.recent or note.kind in ("checkpoint", "left"):
            return [note]
    return []
