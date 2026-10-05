import pytest

from app.models import Dataset, Item
from app.store import Repo


def test_load_and_export_round_trip(repo: Repo, seed_dataset: Dataset):
    assert repo.dataset() == seed_dataset


def test_counts(repo: Repo, seed_dataset: Dataset):
    assert repo.count("event") == len(seed_dataset.events) == 85
    assert repo.count("reserve") == len(seed_dataset.reserves)


def test_fetch_by_parent_and_order(repo: Repo, seed_dataset: Dataset):
    items = repo.fetch("item", parent="AIS-E1-2026-00077")
    assert [i.id for i in items] == [f"AIS-E1-2026-00077-0{n}" for n in range(1, 7)]
    assert repo.fetch("bid", parent="AIS-E1-2026-00077-01") == []
    assert len(repo.fetch("scripted_bid", parent="AIS-E1-2026-00077-01")) == 5


def test_get_put_delete(repo: Repo):
    item = repo.get("item", "AIS-E1-2026-00077-01")
    assert isinstance(item, Item) and item.state == "draft"
    repo.put("item", item.id, item.model_copy(update={"state": "points_reviewed"}),
             parent=item.event_id)
    assert repo.get("item", item.id).state == "points_reviewed"
    repo.delete("item", item.id)
    assert repo.get("item", item.id) is None


def test_update_keeps_order(repo: Repo):
    before = [i.id for i in repo.fetch("item")]
    item = repo.get("item", before[3])
    repo.put("item", item.id, item.model_copy(update={"state": "closed"}), parent=item.event_id)
    assert [i.id for i in repo.fetch("item")] == before


def test_new_rows_go_to_the_end(repo: Repo):
    item = repo.get("item", "AIS-E1-2026-00077-01")
    repo.put("item", "ZZZ-01", item.model_copy(update={"id": "ZZZ-01"}), parent="ZZZ")
    assert repo.fetch("item")[-1].id == "ZZZ-01"


def test_transaction_rolls_back_on_error(repo: Repo):
    with pytest.raises(RuntimeError):
        with repo.transaction():
            repo.delete("item", "AIS-E1-2026-00077-01")
            raise RuntimeError("boom")
    assert repo.get("item", "AIS-E1-2026-00077-01") is not None


def test_reserves_round_trip_as_numbers(repo: Repo, seed_dataset: Dataset):
    some = next(iter(seed_dataset.reserves))
    assert repo.reserves()[some] == seed_dataset.reserves[some]


def test_unknown_kind_is_rejected(repo: Repo):
    with pytest.raises(ValueError):
        repo.fetch("nope")


def test_file_backed_store_persists_and_seeds_once(tmp_path, seed_dataset: Dataset):
    seed_file = tmp_path / "seed.json"
    seed_file.write_text(seed_dataset.model_dump_json(), encoding="utf-8")
    db = tmp_path / "app.db"
    r1 = Repo(db)
    assert r1.seed_if_empty(seed_file) is True
    assert r1.seed_if_empty(seed_file) is False
    r1.put("item", "AIS-E1-2026-00077-01",
           r1.get("item", "AIS-E1-2026-00077-01").model_copy(update={"state": "points_reviewed"}),
           parent="AIS-E1-2026-00077")
    r2 = Repo(db)
    assert r2.get("item", "AIS-E1-2026-00077-01").state == "points_reviewed"
    assert r2.seed_if_empty(seed_file) is False


def test_nested_transactions_commit_together(repo: Repo):
    with repo.transaction():
        repo.delete("item", "AIS-E1-2026-00077-01")
        with repo.transaction():
            repo.delete("item", "AIS-E1-2026-00077-02")
        assert repo.get("item", "AIS-E1-2026-00077-02") is None
    assert repo.get("item", "AIS-E1-2026-00077-01") is None
    assert repo.get("item", "AIS-E1-2026-00077-02") is None
    with repo.transaction():  # depth counter is back to zero, a new outer begins cleanly
        repo.delete("item", "AIS-E1-2026-00077-03")
    assert repo.get("item", "AIS-E1-2026-00077-03") is None


def test_exception_in_an_inner_transaction_rolls_back_everything(repo: Repo):
    with pytest.raises(RuntimeError):
        with repo.transaction():
            repo.delete("item", "AIS-E1-2026-00077-01")
            with repo.transaction():
                repo.delete("item", "AIS-E1-2026-00077-02")
                raise RuntimeError("boom")
    assert repo.get("item", "AIS-E1-2026-00077-01") is not None
    assert repo.get("item", "AIS-E1-2026-00077-02") is not None
    with repo.transaction():  # still usable afterwards
        repo.delete("item", "AIS-E1-2026-00077-01")
    assert repo.get("item", "AIS-E1-2026-00077-01") is None


def test_a_caught_inner_error_still_lets_the_outer_transaction_decide(repo: Repo):
    with repo.transaction():
        repo.delete("item", "AIS-E1-2026-00077-01")
        with pytest.raises(RuntimeError):
            with repo.transaction():
                raise RuntimeError("inner")
    assert repo.get("item", "AIS-E1-2026-00077-01") is None


def test_load_dataset_works_inside_a_transaction(repo: Repo, seed_dataset: Dataset):
    with repo.transaction():
        repo.delete("item", "AIS-E1-2026-00077-01")
        repo.load_dataset(seed_dataset)
    assert repo.dataset() == seed_dataset


def test_read_context_is_reentrant_and_usable_inside_a_transaction(repo: Repo):
    with repo.read():
        with repo.transaction():
            with repo.read():
                assert repo.count("event") == 85
