from fastapi.testclient import TestClient

from app.api import create_app

CASE = {
    "case_no": "NB-E1-2026-00037", "supplier_id": "S-11", "topic": "Training Lunch Cart SC 10124",
    "target": 40_000, "limit": 46_000, "cart_no": "1012400001", "auto_start": True,
    "suppliers": [
        {"sid": "S-11", "name": "Alpha Foods", "lang": "en", "total": 52_000, "rating": 4.2, "payment_code": "ZD30"},
        {"sid": "S-12", "name": "Beta Caterers", "lang": "hi", "total": 55_000, "rating": 3.9, "payment_code": "ZD45"},
        {"sid": "S-13", "name": "Gamma Meals", "lang": "mr", "total": 58_500, "rating": 4.5, "payment_code": "ZD30"},
    ],
}


def _client(repo, seed_dataset):
    return TestClient(create_app(repo, seed_dataset))


def test_a_case_from_ais_becomes_an_event_with_a_conversation(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json=CASE)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["event_id"] == CASE["case_no"] and out["item_id"] == "NB-E1-2026-00037-01"
    s = c.get(f"/api/sessions/{out['session_id']}").json()
    assert s["from_ais"] and s["vendor_id"] == "S-11" and s["vendor_offer"] == 52_000
    assert s["policy"]["band"] == "auto" and s["mode"] == "auto"  # below ten lakh
    item = c.get(f"/api/items/{out['item_id']}").json()
    assert item["item"]["target"] == 40_000 and item["item"]["limit"] == 46_000
    assert [v["vendor_id"] for v in item["next_vendors"]] == ["S-12", "S-13"]  # the other suppliers are the alternatives


def test_opening_the_same_case_again_reuses_the_conversation_and_never_exposes_a_floor(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    first = c.post("/api/handoff", json=CASE).json()
    again = c.post("/api/handoff", json=CASE).json()
    assert first == again
    assert "reserve" not in c.get(f"/api/sessions/{first['session_id']}").text.lower()


def test_a_second_supplier_gets_its_own_conversation_after_the_first_ends(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    first = c.post("/api/handoff", json=CASE).json()
    assert c.post(f"/api/sessions/{first['session_id']}/hand-back", json={"reason": "no deal"}).status_code == 200
    second = c.post("/api/handoff", json={**CASE, "supplier_id": "S-12"})
    assert second.status_code == 200 and second.json()["session_id"] != first["session_id"]


def test_the_buyers_minimum_must_not_exceed_the_maximum(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json={**CASE, "target": 50_000, "limit": 40_000})
    assert r.status_code == 409


def test_an_agreed_ais_case_can_be_closed_here_and_gets_a_contract_document(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    out = c.post("/api/handoff", json={**CASE, "limit": 60_000}).json()
    for _ in range(16):
        s = c.post(f"/api/sessions/{out['session_id']}/advance").json()
        if s["status"] != "active":
            break
    assert s["status"] == "agreed"
    assert c.get(f"/api/events/{out['event_id']}").json()["event"]["from_ais"] is True
    assert c.post(f"/api/items/{out['item_id']}/accept-deal").status_code == 200
    assert c.post(f"/api/events/{out['event_id']}/approve").status_code == 200
    doc = c.get(f"/api/events/{out['event_id']}/contract").json()[0]
    assert doc["request_no"] == CASE["case_no"] and doc["seller_name"] == "Alpha Foods"
    assert doc["total_value"] == s["agreed_price"] and doc["contract_no"] == "CT-E1-00037"


DETAIL = {
    "auto_start": True,
    "case_no": "NB-E1-2026-00050", "supplier_id": "S-11", "topic": "Workshop consumables SC 10130", "target": 90_000,
    "limit": 110_000, "cart_no": "1013000001",
    "suppliers": [
        {"sid": "S-11", "name": "Alpha Foods", "lang": "en", "total": 1, "payment_code": "ZD30"},
        {"sid": "S-12", "name": "Beta Caterers", "lang": "hi", "total": 1, "payment_code": "ZD45"},
    ],
    "items": [
        {"position": 1, "description": "Gloves", "qty": 100, "unit": "EA"},
        {"position": 2, "description": "Cleaning fluid", "qty": 50, "unit": "KG"},
    ],
    "offers": [
        {"sid": "S-11", "position": 1, "unit_price": 500}, {"sid": "S-11", "position": 2, "unit_price": 1000},
        {"sid": "S-12", "position": 1, "unit_price": 520}, {"sid": "S-12", "position": 2, "unit_price": 1100},
    ],
}


def test_a_case_with_positions_gets_one_item_and_one_conversation_per_position(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    out = c.post("/api/handoff", json=DETAIL).json()
    assert [(s["position"], s["item_id"]) for s in out["sessions"]] == [(1, "NB-E1-2026-00050-01"), (2, "NB-E1-2026-00050-02")]
    ev = c.get("/api/events/NB-E1-2026-00050").json()
    assert [(i["description"], i["qty"]) for i in ev["items"]] == [("Gloves", 100), ("Cleaning fluid", 50)]
    again = c.post("/api/handoff", json=DETAIL).json()
    assert again == out  # the same case again opens nothing new
    assert c.get("/api/handoff/NB-E1-2026-00050/result").json()["status"] == "in_negotiation"


def test_the_result_gives_the_negotiated_unit_price_per_supplier_and_position(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    out = c.post("/api/handoff", json={**DETAIL, "limit": 200_000}).json()
    for s in out["sessions"]:
        for _ in range(20):
            if c.post(f"/api/sessions/{s['session_id']}/advance").json()["status"] != "active":
                break
    res = c.get("/api/handoff/NB-E1-2026-00050/result").json()
    assert res["status"] == "agreed" and res["recommended_supplier"] == "S-11"
    first = res["items"][0]
    mine = next(o for o in first["offers"] if o["sid"] == "S-11")
    assert mine["initial_unit_price"] == 500 and 0 < mine["negotiated_unit_price"] <= 500
    other = next(o for o in first["offers"] if o["sid"] == "S-12")
    assert other["negotiated_unit_price"] is None  # the second supplier was not negotiated with
    sup = next(s for s in res["suppliers"] if s["sid"] == "S-11")
    assert sup["initial_total"] == 100_000 and sup["negotiated_total"] <= 100_000


def test_a_case_with_positions_must_price_every_position_for_every_supplier(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    short = {**DETAIL, "offers": DETAIL["offers"][:3]}
    assert c.post("/api/handoff", json=short).status_code == 409
    assert c.post("/api/handoff", json={**DETAIL, "offers": []}).status_code == 409


def test_the_result_of_an_unknown_case_is_not_found(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    assert c.get("/api/handoff/NOPE-1/result").status_code == 404


def test_files_and_details_sent_with_a_case_are_listed_and_can_be_downloaded(repo, seed_dataset):
    import base64

    c = _client(repo, seed_dataset)
    c.post("/api/handoff", json={**DETAIL, "details": [{"label": "Request", "value": "AIS-E1-2026-00087"}]})
    body = {"name": "offer-alpha.pdf", "kind": "offer", "supplier_id": "S-11", "mime": "application/pdf",
            "content_b64": base64.b64encode(b"%PDF-1.4 demo").decode()}
    meta = c.post("/api/handoff/NB-E1-2026-00050/documents", json=body).json()
    assert meta["supplier_name"] == "Alpha Foods" and meta["size"] == 13
    again = c.post("/api/handoff/NB-E1-2026-00050/documents", json=body).json()
    assert again["id"] == meta["id"]  # the same file again replaces, it is not added twice
    info = c.get("/api/events/NB-E1-2026-00050/ais").json()
    assert info["details"] == [{"label": "Request", "value": "AIS-E1-2026-00087"}] and len(info["documents"]) == 1
    got = c.get(f"/api/documents/{meta['id']}/download")
    assert got.content == b"%PDF-1.4 demo" and got.headers["content-type"] == "application/pdf"


def test_a_file_must_be_valid_and_belong_to_an_ais_case(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    c.post("/api/handoff", json=DETAIL)
    bad = {"name": "x.pdf", "kind": "offer", "content_b64": "***"}
    assert c.post("/api/handoff/NB-E1-2026-00050/documents", json=bad).status_code == 409
    ok = {"name": "x.pdf", "kind": "offer", "content_b64": "QUJD"}
    assert c.post("/api/handoff/NOPE-1/documents", json=ok).status_code == 404


def test_the_result_carries_the_conversation(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    out = c.post("/api/handoff", json=DETAIL).json()
    c.post(f"/api/sessions/{out['sessions'][0]['session_id']}/advance")
    msgs = c.get("/api/handoff/NB-E1-2026-00050/result").json()["messages"]
    assert msgs and msgs[0]["position"] == 1 and msgs[0]["text"]


def test_a_supplier_the_desk_already_knows_keeps_its_own_record(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    known = c.get("/api/vendors").json()[0]
    body = {**CASE, "case_no": "NB-E1-2026-00060", "supplier_id": known["id"],
            "suppliers": [{**CASE["suppliers"][0], "sid": known["id"], "name": "Renamed by AIS", "rating": 1.0}, CASE["suppliers"][1]]}
    assert c.post("/api/handoff", json=body).status_code == 200
    after = next(v for v in c.get("/api/vendors").json() if v["id"] == known["id"])
    assert after["name"] == known["name"] and after["rating"] == known["rating"] and after["sap_no"] == known["sap_no"]


def test_an_event_can_be_deleted_with_everything_under_it(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    out = c.post("/api/handoff", json=DETAIL).json()
    c.post("/api/handoff/NB-E1-2026-00050/documents", json={"name": "a.pdf", "kind": "offer", "content_b64": "QUJD"})
    res = c.delete("/api/events/NB-E1-2026-00050")
    assert res.status_code == 200 and res.json()["items"] == 2 and res.json()["conversations"] == 2
    assert c.get("/api/events/NB-E1-2026-00050").status_code == 404
    assert c.get(f"/api/sessions/{out['session_id']}").status_code == 404
    assert c.get("/api/handoff/NB-E1-2026-00050/result").status_code == 404
    assert all(e["id"] != "NB-E1-2026-00050" for e in c.get("/api/events").json())
    assert c.delete("/api/events/NB-E1-2026-00050").status_code == 404


SCRAP = {
    "case_no": "AIS-E1-2026-00200", "direction": "sell", "supplier_id": "B-1", "topic": "Aluminium chips sale",
    "target": 70_000, "limit": 60_000, "auto_start": True,
    "suppliers": [
        {"sid": "B-1", "name": "Alpha Metals", "lang": "en", "total": 62_000},
        {"sid": "B-2", "name": "Beta Recyclers", "lang": "hi", "total": 64_000},
    ],
}


def test_a_scrap_sale_from_ais_is_negotiated_upwards(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json=SCRAP)
    assert r.status_code == 200, r.text
    out = r.json()
    ev = c.get(f"/api/events/{out['event_id']}").json()
    assert ev["event"]["direction"] == "sell" and ev["event"]["type"] == "scrap_sale"
    s = c.get(f"/api/sessions/{out['session_id']}").json()
    assert s["direction"] == "sell" and s["vendor_offer"] == 62_000
    res = c.get(f"/api/handoff/{SCRAP['case_no']}/result").json()
    assert res["status"] == "in_negotiation" and res["recommended_supplier"] is None


def test_a_scrap_sale_floor_must_not_exceed_the_target(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json={**SCRAP, "target": 55_000, "limit": 60_000})
    assert r.status_code == 409


def test_a_case_from_ais_waits_for_the_buyer_to_start_the_negotiation(repo, seed_dataset):
    c = _client(repo, seed_dataset)
    r = c.post("/api/handoff", json={k: v for k, v in CASE.items() if k != "auto_start"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["session_id"] is None and out["sessions"] == []
    item = c.get(f"/api/items/{out['item_id']}").json()
    assert item["item"]["state"] == "analyzed"
    assert c.get(f"/api/handoff/{CASE['case_no']}/result").json()["status"] == "not_started"
    # the Buyer picks a vendor and starts it from the item, like any other event
    s = c.post(f"/api/items/{out['item_id']}/negotiations", json={"vendor_id": "S-12", "mode": "auto"})
    assert s.status_code == 200 and s.json()["from_ais"] and s.json()["vendor_id"] == "S-12"
