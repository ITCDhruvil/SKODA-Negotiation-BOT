"""One place that reads the wall clock, so tests can replace it."""
from __future__ import annotations

from datetime import datetime, timezone


def now() -> datetime:
    """Current time in UTC, to the second."""
    return datetime.now(timezone.utc).replace(microsecond=0)
