"""The research agent.

For each report section we make one streaming call to Claude with the
native `web_search` server tool enabled. Claude decides when to search,
Anthropic executes the search and feeds the results back to the model
within the same request, and we relay progress (search started / results
found) plus the final section content to the caller as a sequence of
`AgentEvent`s.

If no ANTHROPIC_API_KEY is configured, `MockProvider` produces canned
output on the same interface so the rest of the app (streaming pipeline,
SSE wiring, DB persistence, frontend) can be exercised without a key. Only
the "how do I get section content" half is swapped out — everything
upstream of it is unaware which provider is in use.
"""

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional, Protocol

from anthropic import AsyncAnthropic

from app.config import get_settings

SECTIONS = ["overview", "key_people", "news", "financials", "risks"]

SYSTEM_PROMPT = (
    "You are a research analyst preparing a pre-meeting briefing for a sales rep "
    "who is about to talk to a prospective client. Use the web_search tool to find "
    "current, real information before answering. Prefer recent, credible sources. "
    "Never invent facts, names, or numbers — if something cannot be verified, say so "
    "or use null exactly as instructed for that field. Be concise; the rep is reading "
    "this between meetings."
)

_ANSWER_RE = re.compile(r"<answer>(.*?)</answer>", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _section_prompt(section: str, company_name: str) -> str:
    company = company_name
    if section == "overview":
        return (
            f"Research the company '{company}'. Write a concise 3-5 sentence overview "
            "covering what it does, its industry, core products/services, target "
            "customers, and market positioning. Write it like a briefing for a busy "
            "sales rep, not a Wikipedia summary. Respond with ONLY the overview "
            "paragraph — no headings, no JSON, no preamble. If you cannot find a real "
            "company matching this name, say so plainly in one sentence instead."
        )
    if section == "key_people":
        return (
            f"Research the current key executives and senior leadership of '{company}' "
            "who are relevant to a sales conversation (e.g. CEO, CTO, CFO, CIO, CISO, "
            "COO, founders). Confirm current titles via search. Respond with ONLY a "
            'JSON array of objects shaped like {"name": "...", "title": "..."}, wrapped '
            "in <answer></answer> tags and nothing else. Include at most 6 people. If "
            "you find no reliable names, respond with <answer>[]</answer>."
        )
    if section == "news":
        return (
            f"Search for recent news about '{company}' from roughly the last 12 months: "
            "acquisitions, earnings, product launches, partnerships, layoffs, or "
            "leadership changes. Respond with ONLY a JSON array of 3-4 short bullet "
            "strings wrapped in <answer></answer> tags, each stating one fact with an "
            "approximate date if known. Only include things you actually found via "
            "search — never invent news. If you find fewer than 3 credible items, "
            "return only the ones you found. If you find nothing recent, respond with "
            "<answer>[]</answer>."
        )
    if section == "financials":
        return (
            f"Search for '{company}' financial highlights: revenue, employee count, "
            "market capitalization, and year-over-year growth. Respond with ONLY a "
            "JSON object wrapped in <answer></answer> tags shaped like "
            '{"revenue": "...", "employee_count": "...", "market_cap": "...", '
            '"yoy_growth": "..."}. Use JSON null (not the word "unknown") for any field '
            "you cannot verify — private companies typically won't have a market cap. "
            "Never fabricate a number. Prefer the most recent figures you can find and "
            'note the period, e.g. "$4.2B (FY2025)".'
        )
    if section == "risks":
        return (
            f"Search for potential risk factors relevant to a sales conversation with "
            f"'{company}': regulatory scrutiny, security breaches, competitive threats, "
            "pending litigation, or financial instability. Respond with ONLY a JSON "
            "array of 2-3 short bullet strings wrapped in <answer></answer> tags. Only "
            "include real, sourced findings. If you find no notable risks, respond with "
            "<answer>[]</answer>."
        )
    raise ValueError(f"Unknown section: {section}")


def _extract_answer(text: str) -> str:
    match = _ANSWER_RE.search(text)
    body = match.group(1) if match else text
    return _FENCE_RE.sub("", body.strip()).strip()


def _parse_section(section: str, raw_text: str) -> Any:
    text = raw_text.strip()
    if section == "overview":
        return text or "No overview could be generated for this company."
    if section == "financials":
        try:
            data = json.loads(_extract_answer(text))
            if not isinstance(data, dict):
                raise ValueError("expected object")
        except (json.JSONDecodeError, ValueError):
            data = {}
        return {
            "revenue": data.get("revenue"),
            "employee_count": data.get("employee_count"),
            "market_cap": data.get("market_cap"),
            "yoy_growth": data.get("yoy_growth"),
        }
    # key_people, news, risks all parse to a JSON array
    try:
        data = json.loads(_extract_answer(text))
        if not isinstance(data, list):
            raise ValueError("expected array")
    except (json.JSONDecodeError, ValueError):
        return []
    if section == "key_people":
        people = []
        for item in data:
            if isinstance(item, dict) and item.get("name") and item.get("title"):
                people.append({"name": str(item["name"]), "title": str(item["title"])})
        return people[:6]
    # news / risks: list of strings
    return [str(item).strip() for item in data if str(item).strip()][:6]


@dataclass
class AgentEvent:
    kind: str  # "status" | "token" | "final"
    payload: dict[str, Any]


class SectionProvider(Protocol):
    async def stream_section(
        self, section: str, company_name: str
    ) -> AsyncIterator[AgentEvent]: ...


class AnthropicProvider:
    """Real implementation: one streaming Claude call per section, with the
    native `web_search` server tool enabled."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    async def stream_section(
        self, section: str, company_name: str
    ) -> AsyncIterator[AgentEvent]:
        prompt = _section_prompt(section, company_name)
        seen_search = False
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=1200,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}],
        ) as stream:
            async for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if getattr(block, "type", None) == "server_tool_use" and getattr(
                        block, "name", None
                    ) == "web_search":
                        seen_search = True
                        yield AgentEvent("status", {"message": "Searching the web…"})
                    elif getattr(block, "type", None) == "web_search_tool_result":
                        content = getattr(block, "content", None)
                        count = len(content) if isinstance(content, list) else 0
                        yield AgentEvent(
                            "status", {"message": f"Reviewed {count} search result(s)"}
                        )
                elif event.type == "content_block_delta":
                    delta = event.delta
                    if getattr(delta, "type", None) == "text_delta":
                        yield AgentEvent("token", {"text": delta.text})
            if not seen_search:
                yield AgentEvent("status", {"message": "Reasoning from prior knowledge…"})
            final_message = await stream.get_final_message()
        text = "".join(
            block.text for block in final_message.content if getattr(block, "type", None) == "text"
        )
        yield AgentEvent("final", {"text": text})


class MockProvider:
    """Deterministic canned data so the streaming pipeline, SSE wiring, and
    UI can be exercised end-to-end without an API key."""

    async def stream_section(
        self, section: str, company_name: str
    ) -> AsyncIterator[AgentEvent]:
        await asyncio.sleep(0.2)
        yield AgentEvent("status", {"message": "Searching the web… (mock mode)"})
        await asyncio.sleep(0.2)
        yield AgentEvent("status", {"message": "Reviewed 3 search result(s)"})
        text = self._mock_text(section, company_name)
        if section == "overview":
            for word in text.split(" "):
                await asyncio.sleep(0.02)
                yield AgentEvent("token", {"text": word + " "})
        else:
            await asyncio.sleep(0.15)
        yield AgentEvent("final", {"text": text})

    @staticmethod
    def _mock_text(section: str, company_name: str) -> str:
        if section == "overview":
            return (
                f"{company_name} (demo data — configure ANTHROPIC_API_KEY for a real, "
                "web-researched briefing) appears to operate in a competitive market "
                "with a mix of enterprise and mid-market customers. In live mode this "
                "paragraph summarizes what the company actually does, its industry, "
                "products, target customers, and market positioning."
            )
        if section == "key_people":
            return json.dumps(
                [
                    {"name": "Jordan Lee", "title": "Chief Executive Officer"},
                    {"name": "Priya Nair", "title": "Chief Technology Officer"},
                    {"name": "Sam Okafor", "title": "Chief Financial Officer"},
                ]
            )
        if section == "news":
            return json.dumps(
                [
                    f"(Demo) {company_name} announced a new product line (mock data).",
                    f"(Demo) {company_name} reported quarterly results in line with expectations.",
                    "(Demo) A senior leadership hire was announced last quarter.",
                ]
            )
        if section == "financials":
            return json.dumps(
                {
                    "revenue": "$120M (demo)",
                    "employee_count": "~450 (demo)",
                    "market_cap": None,
                    "yoy_growth": "+18% (demo)",
                }
            )
        if section == "risks":
            return json.dumps(
                [
                    "(Demo) Increasing competitive pressure in its core market.",
                    "(Demo) Exposure to evolving data-privacy regulation.",
                ]
            )
        raise ValueError(f"Unknown section: {section}")


def get_provider() -> SectionProvider:
    settings = get_settings()
    if settings.mock_mode:
        return MockProvider()
    return AnthropicProvider(api_key=settings.anthropic_api_key, model=settings.anthropic_model)


async def stream_research(
    company_name: str,
    provider: Optional[SectionProvider] = None,
    is_cancelled: Optional[Any] = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yields SSE-ready event dicts: {"event": str, "data": dict}."""
    provider = provider or get_provider()
    yield {"event": "status", "data": {"message": f"Starting research on {company_name}…"}}

    for section in SECTIONS:
        if is_cancelled is not None and await is_cancelled():
            return
        yield {"event": "section_start", "data": {"section": section}}
        raw_text = ""
        try:
            async for agent_event in provider.stream_section(section, company_name):
                if agent_event.kind == "status":
                    yield {
                        "event": "status",
                        "data": {"section": section, "message": agent_event.payload["message"]},
                    }
                elif agent_event.kind == "token" and section == "overview":
                    yield {
                        "event": "token",
                        "data": {"section": section, "text": agent_event.payload["text"]},
                    }
                elif agent_event.kind == "final":
                    raw_text = agent_event.payload["text"]
            parsed = _parse_section(section, raw_text)
        except Exception as exc:  # noqa: BLE001 - keep the report going even if one section fails
            parsed = _parse_section(section, "")
            yield {
                "event": "status",
                "data": {
                    "section": section,
                    "message": f"Couldn't complete this section ({exc.__class__.__name__}); showing partial data.",
                },
            }
        yield {"event": "section_complete", "data": {"section": section, "data": parsed}}

    yield {"event": "research_complete", "data": {}}
