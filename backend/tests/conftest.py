import pytest

from app.models import Dataset
from app.seed.build import OUTPUT_DIR


@pytest.fixture(scope="session")
def seed_dataset() -> Dataset:
    return Dataset.model_validate_json((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
