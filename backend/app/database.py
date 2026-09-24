"""Thin synchronous SQLite data access layer.

Kept as plain sqlite3 (no ORM) since the schema is a single table — an ORM
would add indirection without buying anything here. Route handlers that call
these functions use plain `def` (not `async def`) so FastAPI runs them in its
threadpool instead of blocking the event loop.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    overview TEXT,
    key_people TEXT NOT NULL DEFAULT '[]',
    news TEXT NOT NULL DEFAULT '[]',
    financials TEXT NOT NULL DEFAULT '{}',
    risks TEXT NOT NULL DEFAULT '[]'
);
"""


def _db_path() -> Path:
    path = Path(get_settings().database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.execute(SCHEMA)


def insert_report(company_name: str, sections: dict[str, Any]) -> int:
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO reports (company_name, created_at, overview, key_people, news, financials, risks)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                company_name,
                datetime.now(timezone.utc).isoformat(),
                sections.get("overview") or "",
                json.dumps(sections.get("key_people") or []),
                json.dumps(sections.get("news") or []),
                json.dumps(sections.get("financials") or {}),
                json.dumps(sections.get("risks") or []),
            ),
        )
        return int(cur.lastrowid)


def list_reports() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, company_name, created_at FROM reports ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def get_report(report_id: int) -> Optional[dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["key_people"] = json.loads(data["key_people"])
        data["news"] = json.loads(data["news"])
        data["financials"] = json.loads(data["financials"])
        data["risks"] = json.loads(data["risks"])
        return data


def delete_report(report_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM reports WHERE id = ?", (report_id,))
        return cur.rowcount > 0
