import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ReportHistory } from "./ReportHistory"

const reports = [
  { id: 1, company_name: "Acme Corp", created_at: new Date().toISOString() },
  { id: 2, company_name: "Globex", created_at: new Date().toISOString() },
]

describe("ReportHistory", () => {
  it("shows an empty-state message when there are no reports", () => {
    render(<ReportHistory reports={[]} selectedId={null} onSelect={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/no reports yet/i)).toBeInTheDocument()
  })

  it("calls onSelect with the clicked report's id", async () => {
    const onSelect = vi.fn()
    render(<ReportHistory reports={reports} selectedId={null} onSelect={onSelect} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByText("Acme Corp"))

    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it("calls onDelete without also triggering onSelect", async () => {
    const onSelect = vi.fn()
    const onDelete = vi.fn()
    render(<ReportHistory reports={reports} selectedId={null} onSelect={onSelect} onDelete={onDelete} />)

    await userEvent.click(screen.getByLabelText("Delete report for Globex"))

    expect(onDelete).toHaveBeenCalledWith(2)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
