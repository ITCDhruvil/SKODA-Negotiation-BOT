"""Regenerate the committed seed data: python scripts/seed.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.seed.build import OUTPUT_DIR, write_outputs  # noqa: E402

if __name__ == "__main__":
    write_outputs()
    print(f"wrote seed data to {OUTPUT_DIR}")
