import threading

from fastapi.testclient import TestClient

from app import readmodel as rm
from app.api import create_app
from app.models import Dataset
from app.simulate import simulate_event
from app.store import Repo


def _run(readers, writer):
    errors: list[BaseException] = []
    stop = threading.Event()

    def guarded(fn):
        try:
            fn()
        except BaseException as exc:  # noqa: BLE001 - reported to the main thread
            errors.append(exc)
            stop.set()

    def loop(fn):
        def go():
            while not stop.is_set():
                fn()
        return go

    threads = [threading.Thread(target=guarded, args=(loop(r),)) for r in readers]
    for t in threads:
        t.start()
    try:
        guarded(writer)
    finally:
        stop.set()
        for t in threads:
            t.join(timeout=60)
    assert not errors, errors[0]


def test_readers_never_fail_while_events_are_simulated(repo: Repo):
    def read_snapshot():
        snap = rm.snapshot(repo)
        rm.dashboard(snap)

    def read_event_view():
        snap = rm.snapshot(repo)
        rm.event_detail(snap, snap.events[-1])

    def write():
        for n in range(20):
            simulate_event(repo, "buy" if n % 2 else "sell")

    _run([read_snapshot, read_snapshot, read_event_view], write)
    assert repo.count("event") == 105


def test_reset_while_readers_run_does_not_raise(repo: Repo, seed_dataset: Dataset):
    client = TestClient(create_app(repo, seed_dataset))

    def read_snapshot():
        rm.dashboard(rm.snapshot(repo))

    def write():
        for _ in range(3):
            simulate_event(repo, "buy")
            assert client.post("/api/admin/reset").status_code == 200

    _run([read_snapshot, read_snapshot], write)
    assert repo.count("event") == 85
