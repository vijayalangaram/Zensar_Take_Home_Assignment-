import asyncio
import json
import re
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.agent import stream_research
from app.config import get_settings
from app.database import delete_report, get_report, init_db, insert_report, list_reports
from app.schemas import ReportDetail, ReportSummary, ResearchRequest


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="Company Research Tool", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Company names (lowercased) with research currently in flight — guards
# against firing duplicate concurrent research for the same company.
_active_research: set[str] = set()
_active_lock = asyncio.Lock()

_NAME_HAS_LETTER = re.compile(r"[A-Za-z]")


def _validate_company_name(name: str) -> str:
    name = name.strip()
    if not (2 <= len(name) <= 120) or not _NAME_HAS_LETTER.search(name):
        raise HTTPException(status_code=422, detail="Please enter a valid company name.")
    return name


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/api/research")
async def research(payload: ResearchRequest, request: Request) -> StreamingResponse:
    company_name = _validate_company_name(payload.company_name)
    key = company_name.lower()

    async with _active_lock:
        if key in _active_research:
            raise HTTPException(
                status_code=409,
                detail=f"Research for '{company_name}' is already in progress.",
            )
        _active_research.add(key)

    async def event_stream():
        sections: dict[str, Any] = {}
        completed = False
        try:
            async for evt in stream_research(
                company_name, is_cancelled=request.is_disconnected
            ):
                if evt["event"] == "section_complete":
                    sections[evt["data"]["section"]] = evt["data"]["data"]
                elif evt["event"] == "research_complete":
                    completed = True
                yield _sse(evt["event"], evt["data"])
        except Exception as exc:  # noqa: BLE001 - surface as an SSE error, not a stack trace
            yield _sse("error", {"message": f"Research failed: {exc}"})
        finally:
            async with _active_lock:
                _active_research.discard(key)
        if completed:
            report_id = insert_report(company_name, sections)
            yield _sse("done", {"report_id": report_id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/reports", response_model=list[ReportSummary])
def get_reports() -> list[dict[str, Any]]:
    return list_reports()


@app.get("/api/reports/{report_id}", response_model=ReportDetail)
def get_report_detail(report_id: int) -> dict[str, Any]:
    report = get_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    return report


@app.delete("/api/reports/{report_id}", status_code=204)
def delete_report_endpoint(report_id: int) -> None:
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found.")


@app.get("/api/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "mock_mode": get_settings().mock_mode})
