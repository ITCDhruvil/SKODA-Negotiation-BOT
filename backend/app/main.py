"""Uvicorn entry point: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from pathlib import Path

from app.api import create_app
from app.seed.build import OUTPUT_DIR
from app.store import Repo

_repo = Repo(os.environ.get("NEGOTIATION_DB", str(Path(__file__).resolve().parents[1] / "data" / "app.db")))
_repo.seed_if_empty(OUTPUT_DIR / "dataset.json")
app = create_app(_repo)
