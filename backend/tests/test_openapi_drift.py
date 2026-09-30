import json
from pathlib import Path

from app.api import create_app
from app.models import Dataset
from app.store import Repo

OPENAPI = Path(__file__).resolve().parents[1] / "openapi.json"


def test_committed_openapi_matches_the_running_app(repo: Repo, seed_dataset: Dataset):
    """The frontend types are generated from openapi.json: regenerate both when the API changes.

    Run: python scripts/export_openapi.py  then, in frontend/, npm run gen:types
    """
    committed = json.loads(OPENAPI.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(create_app(repo, seed_dataset).openapi()))
