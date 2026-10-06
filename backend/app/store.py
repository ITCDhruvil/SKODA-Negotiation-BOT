"""SQLite document store: every model is a JSON document keyed by (kind, id)."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

from app.models import AisDoc, AisInfo, Bid, Dataset, Draft, Event, HistoryRecord, Item, Outcome, Session, Turn, Vendor

KINDS: dict[str, Any] = {
    "vendor": Vendor, "event": Event, "item": Item, "bid": Bid, "scripted_bid": Bid,
    "outcome": Outcome, "history": HistoryRecord, "reserve": None,
    "session": Session, "turn": Turn, "draft": Draft, "ais_doc": AisDoc, "ais_info": AisInfo,
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    kind TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, seq INTEGER NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (kind, id));
CREATE INDEX IF NOT EXISTS docs_parent ON docs (kind, parent);
"""


class Repo:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        self._depth = 0
        with self._lock:
            self._conn.executescript(_SCHEMA)

    @contextmanager
    def transaction(self):
        """Re-entrant: only the outermost call begins and commits; an error rolls everything back."""
        with self._lock:
            outer = self._depth == 0
            if outer:
                self._conn.execute("BEGIN")
            self._depth += 1
            try:
                yield self
            except BaseException:
                self._depth -= 1
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                self._depth -= 1
                if outer:
                    self._conn.execute("COMMIT")

    @contextmanager
    def read(self):
        """Hold the lock so several fetches see one consistent state."""
        with self._lock:
            yield self

    @staticmethod
    def _check(kind: str) -> None:
        if kind not in KINDS:
            raise ValueError(f"unknown kind {kind!r}")

    @staticmethod
    def _decode(kind: str, body: str):
        cls = KINDS[kind]
        return json.loads(body) if cls is None else cls.model_validate_json(body)

    def put(self, kind: str, id: str, value: Any, parent: Optional[str] = None) -> None:
        self._check(kind)
        body = value.model_dump_json() if isinstance(value, BaseModel) else json.dumps(value)
        with self._lock:
            self._conn.execute(
                "INSERT INTO docs (kind, id, parent, seq, body) VALUES "
                "(?, ?, ?, COALESCE((SELECT MAX(seq) FROM docs WHERE kind = ?), 0) + 1, ?) "
                "ON CONFLICT (kind, id) DO UPDATE SET "
                "parent = COALESCE(excluded.parent, parent), body = excluded.body",
                (kind, id, parent, kind, body),
            )

    def get(self, kind: str, id: str):
        self._check(kind)
        with self._lock:
            row = self._conn.execute(
                "SELECT body FROM docs WHERE kind = ? AND id = ?", (kind, id)).fetchone()
        return None if row is None else self._decode(kind, row[0])

    def fetch(self, kind: str, parent: Optional[str] = None) -> list:
        self._check(kind)
        sql, args = "SELECT body FROM docs WHERE kind = ?", [kind]
        if parent is not None:
            sql += " AND parent = ?"
            args.append(parent)
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY seq", args).fetchall()
        return [self._decode(kind, r[0]) for r in rows]

    def delete(self, kind: str, id: str) -> None:
        self._check(kind)
        with self._lock:
            self._conn.execute("DELETE FROM docs WHERE kind = ? AND id = ?", (kind, id))

    def count(self, kind: str) -> int:
        self._check(kind)
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM docs WHERE kind = ?", (kind,)).fetchone()[0]

    def reserves(self) -> dict[str, float]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, body FROM docs WHERE kind = 'reserve' ORDER BY seq").fetchall()
        return {r[0]: json.loads(r[1]) for r in rows}

    def load_dataset(self, ds: Dataset) -> None:
        with self.transaction():
            self._conn.execute("DELETE FROM docs")
            for v in ds.vendors:
                self.put("vendor", v.id, v)
            for e in ds.events:
                self.put("event", e.id, e)
            for i in ds.items:
                self.put("item", i.id, i, parent=i.event_id)
            for b in ds.bids:
                self.put("bid", b.id, b, parent=b.item_id)
            for b in ds.scripted_bids:
                self.put("scripted_bid", b.id, b, parent=b.item_id)
            for o in ds.outcomes:
                self.put("outcome", o.item_id, o, parent=o.item_id)
            for h in ds.history:
                self.put("history", h.id, h)
            for bid_id, value in ds.reserves.items():
                self.put("reserve", bid_id, value)

    def dataset(self) -> Dataset:
        return Dataset(
            vendors=self.fetch("vendor"), events=self.fetch("event"), items=self.fetch("item"),
            bids=self.fetch("bid"), scripted_bids=self.fetch("scripted_bid"),
            outcomes=self.fetch("outcome"), history=self.fetch("history"),
            reserves=self.reserves(),
        )

    def seed_if_empty(self, seed_path: str | Path) -> bool:
        if self.count("event") > 0:
            return False
        ds = Dataset.model_validate_json(Path(seed_path).read_text(encoding="utf-8"))
        self.load_dataset(ds)
        return True
