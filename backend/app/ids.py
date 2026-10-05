"""Event numbers in the format the AIS prototype uses for request numbers: AIS-E1-2026-00048.

E1 is the legal entity and 2026 the year. The sequence starts at 37, the next free number after the prototype's own
sample requests, so the event numbered n in the sample data is request 36 + n.
"""
from __future__ import annotations

import re

PREFIX = "AIS-E1-2026"
OFFSET = 36


def event_id(n: int) -> str:
    return f"{PREFIX}-{n + OFFSET:05d}"


def event_number(event_id_: str) -> int:
    """The running number of an event, the inverse of event_id."""
    return int(event_id_.rsplit("-", 1)[1]) - OFFSET



_REQUEST = re.compile(r"AIS-E1-2026-(\d{5})")


def legacy_key(any_id: str) -> str:
    """The id as it was written before the AIS format (EVT-2026-041-01-B1 for AIS-E1-2026-00077-01-B1).

    The simulated vendors take their pace, persona and pauses from a hash of the bid id. Hashing this older spelling
    keeps every conversation exactly as it was before the ids were renamed.
    """
    return _REQUEST.sub(lambda m: f"EVT-2026-{int(m.group(1)) - OFFSET:03d}", any_id)
