"""Delete an event with everything that hangs off it: its items, quotes, conversations and outcomes."""
from __future__ import annotations

from app.negotiation import service as neg
from app.services import NotFound
from app.store import Repo


def delete_event(repo: Repo, event_id: str) -> dict[str, int]:
    if repo.get("event", event_id) is None:
        raise NotFound(f"event {event_id} not found")
    gone = {"items": 0, "quotes": 0, "conversations": 0}
    with repo.transaction():
        for item in repo.fetch("item", parent=event_id):
            for bid in repo.fetch("bid", parent=item.id):
                repo.delete("reserve", bid.id)
                repo.delete("bid", bid.id)
                gone["quotes"] += 1
            for sb in repo.fetch("scripted_bid", parent=item.id):
                repo.delete("scripted_bid", sb.id)
            for s in neg.sessions_for_item(repo, item.id):
                for t in repo.fetch("turn", parent=s.id):
                    repo.delete("turn", t.id)
                for d in repo.fetch("draft", parent=s.id):
                    repo.delete("draft", d.id)
                repo.delete("session", s.id)
                gone["conversations"] += 1
            repo.delete("outcome", item.id)
            repo.delete("item", item.id)
            gone["items"] += 1
        for doc in repo.fetch("ais_doc", parent=event_id):
            repo.delete("ais_doc", doc.id)
        repo.delete("ais_info", event_id)
        repo.delete("event", event_id)
    return gone
