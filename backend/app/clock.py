"""One place that reads the wall clock, so tests can replace it."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


def now() -> datetime:
    """Current time in UTC, to the second."""
    return datetime.now(timezone.utc).replace(microsecond=0)


_IST = timedelta(hours=5, minutes=30)


def today() -> date:
    """Today's calendar date in India (UTC+5:30), which is what the business day means here."""
    return (now() + _IST).date()
