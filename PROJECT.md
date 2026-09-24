# Company Research Tool — Project Documentation

## 1. What this is

A fullstack web app for sales reps (Account Executives / SDRs). The rep types
a company name, an AI agent researches that company live on the web, and the
UI streams back a structured 5-section briefing in real time — designed to be
scannable in about two minutes before a meeting.

Built to the spec in `Full Stack Eng - Take home assignment.pdf`: FastAPI +
SQLite backend, React + TypeScript frontend, Anthropic Claude as the AI/search
provider, Server-Sent Events for streaming.

## 2. Status

| Area | Status |
|---|---|
| Backend endpoints (`/api/research`, `/api/reports`, `/api/reports/{id}`, `/api/health`) | Done |
| SSE streaming pipeline | Done |
| SQLite persistence (create / list / get / delete) | Done |
| Research agent (Anthropic Claude + native `web_search` tool) | Done, real implementation |
| Mock-mode fallback (no API key required to run/demo) | Done |
| Frontend (search, streaming report view, history sidebar) | Done |
| Empty / streaming / error / complete / invalid-input states | Done |
| Backend tests (pytest) | 21/21 passing |
| Frontend tests (vitest + Testing Library) | 23/23 passing |
| TypeScript build (`tsc -b`) | Clean, no errors |
| Production build (`vite build`) | Builds successfully |
| Manual browser verification (Playwright-driven) | Done — see §7 |
| Nice-to-haves implemented | Cancel in-progress research, per-section streaming indicator, Ctrl/Cmd+K shortcut, responsive layout, relative timestamps, duplicate-request prevention |
| Nice-to-haves *not* implemented | PDF/CSV export (explicitly out of scope), toast/undo on delete |

There are no known build failures. `npm run build` and `pytest` both pass
cleanly as of the last verification pass.

## 3. Repository layout

```
assesmentzensar/
├── README.md                  Setup + provider rationale + trade-offs (submission doc)
├── PROJECT.md                 This file — full project documentation
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, routes, SSE wiring, CORS, lifespan
│   │   ├── agent.py           The research agent (real + mock providers)
│   │   ├── database.py        Plain sqlite3 data access layer
│   │   ├── schemas.py         Pydantic request/response models
│   │   └── config.py          Settings (env vars, mock-mode detection)
│   ├── tests/
│   │   ├── test_agent.py      Agent parsing + streaming behavior
│   │   ├── test_reports_api.py CRUD + validation + duplicate-guard tests
│   │   └── conftest.py        Isolated SQLite file per test
│   ├── requirements.txt
│   ├── pyproject.toml         pytest config (asyncio mode, pythonpath)
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx             Top-level layout & state wiring
    │   ├── api/client.ts       fetch wrapper + manual SSE parser
    │   ├── hooks/useResearch.ts  Streaming state machine (useReducer)
    │   ├── components/
    │   │   ├── SearchBar.tsx
    │   │   ├── ReportHistory.tsx
    │   │   └── ReportView.tsx
    │   ├── utils/time.ts       Relative-timestamp formatting
    │   └── types.ts            Shared TS types for report sections
    ├── package.json
    ├── vite.config.ts          Includes Vitest test config
    └── .env.example
```

## 4. How the pieces fit together

### Request flow

1. User submits a company name in `SearchBar`.
2. `useResearch().start()` opens a `fetch(..., { method: "POST" })` to
   `/api/research` with an `AbortController` signal, and begins reading the
   response body as a stream.
3. Backend (`main.py::research`) validates the name, registers it in an
   in-memory "active research" set (duplicate guard), and returns a
   `StreamingResponse` backed by the `stream_research()` async generator in
   `agent.py`.
4. `stream_research()` loops over the 5 sections in order (`overview`,
   `key_people`, `news`, `financials`, `risks`). For each section it calls
   the configured `SectionProvider` (real Anthropic or mock), forwarding
   `status`/`token` events live and emitting `section_complete` once that
   section's Claude call finishes and its response is parsed.
5. On the frontend, `useResearch`'s reducer updates `sectionStatus` and
   `sections` as each event arrives, so `ReportView` re-renders progressively
   — sections appear one at a time instead of all at once.
6. When all 5 sections finish, the backend saves the report to SQLite and
   emits a `done` event carrying the new `report_id`; the frontend then
   refreshes the history sidebar.

### The agent (`backend/app/agent.py`)

- One streaming Claude call **per section**, each with a section-specific
  prompt and JSON schema description.
- Uses Anthropic's server-side `web_search` tool (`type:
  "web_search_20250305"`) — Claude decides when to search; Anthropic executes
  the search and returns results within the same streamed response. No
  separate search API or client-side tool-call loop needed.
- Structured sections (`key_people`, `news`, `financials`, `risks`) ask Claude
  to answer inside `<answer>...</answer>` tags, which are extracted with a
  regex and `json.loads`'d — robust to any stray preamble text the model adds.
- The `overview` section skips JSON entirely and streams raw prose
  token-by-token, which is what powers the live "typing" effect in the UI.
- Every section call is wrapped in a `try/except`: if one section's Claude
  call fails, that section falls back to an empty/null placeholder and the
  rest of the report still completes — one bad section never kills the whole
  briefing.
- `MockProvider` mirrors the exact same event interface (`status` → `token`
  → `final`) with small `asyncio.sleep` delays and clearly-labeled "(demo)"
  data, so the whole pipeline — SSE wiring, DB writes, UI states — can be
  exercised with zero API keys and zero cost.

### SSE event schema

| Event | Payload | Meaning |
|---|---|---|
| `status` | `{message, section?}` | Human-readable progress ("Searching the web…") |
| `section_start` | `{section}` | A section has begun |
| `token` | `{section, text}` | A prose delta (overview only) |
| `section_complete` | `{section, data}` | Final parsed value for that section |
| `research_complete` | `{}` | All 5 sections finished |
| `done` | `{report_id}` | Report persisted; carries its new id |
| `error` | `{message}` | Unrecoverable failure |

### Database

Single SQLite table, `reports`, with section data stored as JSON text columns
(`key_people`, `news`, `financials`, `risks`) and `overview` as plain text.
No ORM — a single table doesn't need one. Access is via plain `sqlite3` in
`database.py`, with a fresh connection per call; CRUD functions are synchronous
so FastAPI runs them in its threadpool automatically (`def`, not `async def`,
route handlers).

## 5. Design decisions & why

- **Per-section LLM calls instead of one combined call.** Maps directly onto
  progressive SSE events and isolates failures per section, at the cost of
  more total API round-trips.
- **Anthropic for both LLM and search.** One API key, no separate search
  provider integration, and the native `web_search` tool genuinely executes
  live search rather than relying on the model's training data.
- **Manual SSE parsing over `fetch`, not `EventSource`.** `EventSource`
  cannot send a POST body, and the spec requires `POST /api/research`. The
  frontend reads `response.body` as a `ReadableStream`, buffers across chunk
  boundaries, and splits on the SSE blank-line separator (tested explicitly
  against a chunk boundary that splits an event in half).
- **Graceful degradation over gibberish-detection.** Rather than trying to
  heuristically reject "unresearchable" names (which risks false-positiving on
  legitimate small or non-English company names), the backend only validates
  basic shape (length, contains a letter) and lets the agent itself degrade
  gracefully — empty arrays, null financial fields, or a one-line "couldn't
  find this company" overview.
- **In-memory duplicate-request guard.** A `set()` of lowercased company
  names currently being researched, checked/added under an `asyncio.Lock`.
  Simple, correct for a single-process app, and explicitly not meant to
  survive a restart or scale to multiple processes.

## 6. Known trade-offs / limitations

- Token-level streaming only applies to the `overview` section; the other
  four are structured data and reveal all-at-once per section (still
  section-level progressive rendering, just not token-level).
- No retry/backoff on transient Anthropic API errors — a failed section
  falls straight back to a placeholder rather than retrying.
- No source citations surfaced in the UI, even though the `web_search` tool
  returns them internally.
- The duplicate-request guard and cancellation are process-local (in-memory),
  which is fine for this single-instance SQLite app but wouldn't survive a
  multi-instance deployment.

## 7. Verification performed

- **Backend**: `pytest` — 21 tests covering CRUD endpoints, input validation,
  the duplicate-in-progress guard, SSE event ordering/content, section JSON
  parsing (including malformed/garbage LLM output), and the mock provider.
- **Frontend**: `vitest` — 23 tests covering the SSE parser (including a
  chunk-boundary split mid-event), API error handling, the streaming state
  machine (`useResearch`, including abort-on-cancel and abort-on-unmount),
  and each component's rendering states (pending/active/done, empty-section
  messages, null-field rendering).
- **Type safety**: `tsc -b` passes with no errors.
- **Production build**: `npm run build` succeeds.
- **Manual, in-browser verification**: both servers were started (backend in
  mock mode, frontend dev server) and driven with a headless-Chromium
  Playwright script through the full user flow — empty state, submitting a
  search, watching sections stream in progressively, viewing the completed
  report, loading a report from history, deleting a report, and submitting
  invalid input. Screenshots were inspected at each step. This pass caught
  and fixed one real bug: an invalid company name briefly rendered a "ghost"
  report card full of "Waiting…" placeholders under the error banner; fixed
  by not treating an error that occurred *before any section started* as a
  reason to render the report view.

## 8. Running it

See `README.md` for exact commands. Short version:

```bash
# backend
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # optionally set ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Runs fully in mock mode with no API key. Set `ANTHROPIC_API_KEY` in
`backend/.env` to get real, live-researched reports.
