import json

from app.importer import parse_report
from app.seed.build import OUTPUT_DIR, build_dataset, build_positions


def test_committed_dataset_matches_a_fresh_build():
    committed = json.loads((OUTPUT_DIR / "dataset.json").read_text(encoding="utf-8"))
    fresh = json.loads(build_dataset().model_dump_json())
    assert committed == fresh


def test_committed_csv_parses_and_matches_positions():
    parsed = parse_report(OUTPUT_DIR / "open_shopping_cart_report.csv")
    assert parsed.positions == build_positions()
    assert parsed.warnings == []
