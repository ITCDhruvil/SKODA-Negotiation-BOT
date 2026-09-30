"""Uvicorn entry point: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from pathlib import Path

from app.api import create_app
from app.models import Dataset
from app.seed.build import OUTPUT_DIR
from app.store import Repo

_DB_DEFAULT = Path(__file__).resolve().parents[1] / "data" / "app.db"
_SEED_FILE = OUTPUT_DIR / "dataset.json"

_repo = Repo(os.environ.get("NEGOTIATION_DB", str(_DB_DEFAULT)))
_repo.seed_if_empty(_SEED_FILE)
app = create_app(_repo, Dataset.model_validate_json(_SEED_FILE.read_text(encoding="utf-8")))
