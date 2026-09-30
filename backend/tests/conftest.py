import pytest

from app.models import Dataset
from app.seed.build import OUTPUT_DIR
from app.store import Repo  # noqa: E402


@pytest.fixture(scope="session")
def seed_dataset() -> Dataset:
    return Dataset.model_validate_json((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))


@pytest.fixture
def repo(seed_dataset: Dataset) -> Repo:
    r = Repo()
    r.load_dataset(seed_dataset)
    return r
