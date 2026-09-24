import json

import pytest
from fastapi import HTTPException

from app import main as main_module
from app.schemas import ResearchRequest


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        event_type = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        events.append((event_type, data))
    return events


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["mock_mode"] is True


def test_list_reports_starts_empty(client):
    assert client.get("/api/reports").json() == []


def test_get_missing_report_returns_404(client):
    assert client.get("/api/reports/999999").status_code == 404


def test_delete_missing_report_returns_404(client):
    assert client.delete("/api/reports/999999").status_code == 404


@pytest.mark.parametrize("name", ["", "   ", "1234", "!!!", "a"])
def test_invalid_company_name_returns_422(client, name):
    resp = client.post("/api/research", json={"company_name": name})
    assert resp.status_code == 422


def test_research_streams_all_sections_and_persists_report(client):
    resp = client.post("/api/research", json={"company_name": "Acme Corp"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(resp.text)
    event_types = [t for t, _ in events]
    assert event_types[0] == "status"
    assert "done" in event_types

    completed_sections = [d["section"] for t, d in events if t == "section_complete"]
    assert completed_sections == ["overview", "key_people", "news", "financials", "risks"]

    report_id = next(d["report_id"] for t, d in events if t == "done")

    listed = client.get("/api/reports").json()
    assert any(r["id"] == report_id and r["company_name"] == "Acme Corp" for r in listed)

    detail = client.get(f"/api/reports/{report_id}").json()
    assert detail["overview"]
    assert isinstance(detail["key_people"], list) and detail["key_people"]
    assert isinstance(detail["news"], list)
    assert set(detail["financials"].keys()) == {
        "revenue",
        "employee_count",
        "market_cap",
        "yoy_growth",
    }
    assert isinstance(detail["risks"], list)

    delete_resp = client.delete(f"/api/reports/{report_id}")
    assert delete_resp.status_code == 204
    assert client.get(f"/api/reports/{report_id}").status_code == 404


async def test_duplicate_concurrent_research_is_rejected(client):
    class _FakeRequest:
        async def is_disconnected(self) -> bool:
            return False

    main_module._active_research.add("acme corp")
    try:
        with pytest.raises(HTTPException) as exc_info:
            await main_module.research(ResearchRequest(company_name="Acme Corp"), _FakeRequest())
        assert exc_info.value.status_code == 409
    finally:
        main_module._active_research.discard("acme corp")
