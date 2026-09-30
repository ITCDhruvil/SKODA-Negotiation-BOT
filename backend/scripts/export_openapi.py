"""Write the API schema for the frontend type generator: python scripts/export_openapi.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import create_app  # noqa: E402
from app.models import Dataset  # noqa: E402
from app.seed.build import OUTPUT_DIR  # noqa: E402
from app.store import Repo  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "openapi.json"

if __name__ == "__main__":
    ds = Dataset.model_validate_json((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
    repo = Repo()
    repo.load_dataset(ds)
    OUT.write_text(json.dumps(create_app(repo, ds).openapi(), indent=1), encoding="utf-8",
                   newline="\n")
    print(f"wrote {OUT}")
