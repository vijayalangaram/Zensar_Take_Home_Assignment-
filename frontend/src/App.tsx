import { useCallback, useEffect, useState } from "react"
import "./App.css"
import { ApiError, deleteReport, getReport, listReports } from "./api/client"
import { ReportHistory } from "./components/ReportHistory"
import { ReportView } from "./components/ReportView"
import { useResearch } from "./hooks/useResearch"
import type { ReportDetail, ReportSummary, SectionKey, SectionStatus } from "./types"
import { SearchBar } from "./components/SearchBar"

const ALL_SECTIONS_DONE: Record<SectionKey, SectionStatus> = {
  overview: "done",
  key_people: "done",
  news: "done",
  financials: "done",
  risks: "done",
}

function errorMessageFrom(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export default function App() {
  const { state, start, cancel, reset } = useResearch()
  const [history, setHistory] = useState<ReportSummary[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null)
  const [selectedLoadError, setSelectedLoadError] = useState<string | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      const reports = await listReports()
      setHistory(reports)
      setHistoryError(null)
    } catch (err) {
      setHistoryError(errorMessageFrom(err, "Couldn't reach the server to load past reports."))
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    if (state.phase === "complete") void refreshHistory()
  }, [state.phase, refreshHistory])

  const handleSearch = (companyName: string) => {
    setSelectedReport(null)
    setSelectedLoadError(null)
    void start(companyName)
  }

  const handleSelectHistory = async (id: number) => {
    reset()
    setSelectedLoadError(null)
    try {
      const report = await getReport(id)
      setSelectedReport(report)
    } catch (err) {
      setSelectedReport(null)
      setSelectedLoadError(errorMessageFrom(err, "Couldn't load that report."))
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteReport(id)
      setHistory((prev) => prev?.filter((report) => report.id !== id) ?? prev)
      setSelectedReport((prev) => (prev?.id === id ? null : prev))
    } catch (err) {
      setHistoryError(errorMessageFrom(err, "Couldn't delete that report."))
    }
  }

  const isStreaming = state.phase === "streaming"
  const hasAnyProgress = Object.values(state.sectionStatus).some((status) => status !== "pending")
  // On phase "error" thrown before any section streamed (e.g. input validation
  // failed before the request even reached the agent), there's nothing to show
  // yet — rendering the report card would just be an empty shell under the banner.
  const showingLiveResult =
    selectedReport === null &&
    (state.phase === "streaming" || state.phase === "complete" || (state.phase === "error" && hasAnyProgress))

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1 className="app-title">Company Research</h1>
        {historyError && <p className="banner banner-error">{historyError}</p>}
        {history === null ? (
          <p className="history-empty">Loading history…</p>
        ) : (
          <ReportHistory
            reports={history}
            selectedId={selectedReport?.id ?? null}
            onSelect={(id) => void handleSelectHistory(id)}
            onDelete={(id) => void handleDelete(id)}
          />
        )}
      </aside>

      <main className="main-content">
        <SearchBar onSearch={handleSearch} disabled={isStreaming} />

        {isStreaming && (
          <div className="status-banner">
            <span className="spinner" aria-hidden />
            <span>{state.statusMessage ?? "Researching…"}</span>
            <button type="button" className="link-button" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <div className="banner banner-error">
            <span>{state.errorMessage}</span>
            <button type="button" className="link-button" onClick={reset}>
              Dismiss
            </button>
          </div>
        )}

        {selectedLoadError && <div className="banner banner-error">{selectedLoadError}</div>}

        {selectedReport && (
          <ReportView
            companyName={selectedReport.company_name}
            sections={selectedReport}
            sectionStatus={ALL_SECTIONS_DONE}
            overviewDraft=""
          />
        )}

        {!selectedReport && showingLiveResult && (
          <ReportView
            companyName={state.companyName ?? ""}
            sections={state.sections}
            sectionStatus={state.sectionStatus}
            overviewDraft={state.overviewDraft}
          />
        )}

        {!selectedReport && !showingLiveResult && (
          <div className="empty-state">
            <p className="empty-state-emoji" aria-hidden>
              🔎
            </p>
            <p>Enter a company name above to generate a pre-meeting briefing.</p>
            <p className="empty-state-hint">
              You'll get a company overview, key people, recent news, financials, and risk
              factors — usually in under a minute.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
