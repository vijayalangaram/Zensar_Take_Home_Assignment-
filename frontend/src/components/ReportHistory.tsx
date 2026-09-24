import type { ReportSummary } from "../types"
import { relativeTime } from "../utils/time"

interface Props {
  reports: ReportSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onDelete: (id: number) => void
}

export function ReportHistory({ reports, selectedId, onSelect, onDelete }: Props) {
  if (reports.length === 0) {
    return <p className="history-empty">No reports yet — research a company to get started.</p>
  }

  return (
    <ul className="history-list">
      {reports.map((report) => (
        <li
          key={report.id}
          className={report.id === selectedId ? "history-item history-item-active" : "history-item"}
        >
          <button className="history-item-main" onClick={() => onSelect(report.id)}>
            <span className="history-company">{report.company_name}</span>
            <span className="history-time">{relativeTime(report.created_at)}</span>
          </button>
          <button
            className="history-delete"
            aria-label={`Delete report for ${report.company_name}`}
            onClick={() => onDelete(report.id)}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}
