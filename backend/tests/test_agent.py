import json

from app.agent import SECTIONS, MockProvider, _extract_answer, _parse_section, stream_research


def test_extract_answer_strips_tags_and_fences():
    raw = "preamble\n<answer>```json\n[1, 2, 3]\n```</answer>\ntrailing"
    assert _extract_answer(raw) == "[1, 2, 3]"


def test_extract_answer_falls_back_to_full_text_without_tags():
    assert _extract_answer("  hello world  ") == "hello world"


def test_parse_section_financials_defaults_missing_fields_to_none():
    raw = '<answer>{"revenue": "$1B"}</answer>'
    assert _parse_section("financials", raw) == {
        "revenue": "$1B",
        "employee_count": None,
        "market_cap": None,
        "yoy_growth": None,
    }


def test_parse_section_financials_handles_garbage_without_crashing():
    assert _parse_section("financials", "not json at all") == {
        "revenue": None,
        "employee_count": None,
        "market_cap": None,
        "yoy_growth": None,
    }


def test_parse_section_key_people_filters_malformed_entries():
    raw = json.dumps(
        [
            {"name": "Ada Lovelace", "title": "CTO"},
            {"name": "Missing title"},
            "not even a dict",
        ]
    )
    assert _parse_section("key_people", f"<answer>{raw}</answer>") == [
        {"name": "Ada Lovelace", "title": "CTO"}
    ]


def test_parse_section_news_returns_empty_list_on_garbage():
    assert _parse_section("news", "nonsense, not an array") == []


def test_parse_section_overview_falls_back_when_blank():
    assert _parse_section("overview", "   ") == "No overview could be generated for this company."


async def test_mock_provider_yields_final_text_for_every_section():
    provider = MockProvider()
    for section in SECTIONS:
        events = [e async for e in provider.stream_section(section, "Acme Corp")]
        assert events[-1].kind == "final"
        assert events[-1].payload["text"].strip()


async def test_stream_research_emits_sections_in_order_and_saves_data():
    events = [e async for e in stream_research("Acme Corp", provider=MockProvider())]
    event_types = [e["event"] for e in events]

    assert event_types[0] == "status"
    assert event_types[-1] == "research_complete"

    starts = [e["data"]["section"] for e in events if e["event"] == "section_start"]
    completes = [e["data"]["section"] for e in events if e["event"] == "section_complete"]
    assert starts == SECTIONS
    assert completes == SECTIONS

    overview_tokens = [e for e in events if e["event"] == "token"]
    assert overview_tokens, "overview should stream token deltas"
    assert all(e["data"]["section"] == "overview" for e in overview_tokens)


async def test_stream_research_stops_early_when_client_disconnects():
    async def cancelled() -> bool:
        return True

    events = [
        e
        async for e in stream_research("Acme Corp", provider=MockProvider(), is_cancelled=cancelled)
    ]
    assert not any(e["event"] in ("section_start", "section_complete") for e in events)
