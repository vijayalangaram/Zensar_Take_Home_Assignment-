import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ReportSections, SectionKey, SectionStatus } from "../types"
import { ReportView } from "./ReportView"

const doneStatus: Record<SectionKey, SectionStatus> = {
  overview: "done",
  key_people: "done",
  news: "done",
  financials: "done",
  risks: "done",
}

describe("ReportView", () => {
  it("shows a waiting placeholder for pending sections", () => {
    const pendingStatus: Record<SectionKey, SectionStatus> = { ...doneStatus, risks: "pending" }
    render(<ReportView companyName="Acme" sections={{}} sectionStatus={pendingStatus} overviewDraft="" />)
    expect(screen.getAllByText("Waiting…").length).toBeGreaterThan(0)
  })

  it("renders completed section content, including a dash for missing financial fields", () => {
    const sections: ReportSections = {
      overview: "Acme makes widgets.",
      key_people: [{ name: "Jane Doe", title: "CEO" }],
      news: ["Acme launched a new product."],
      financials: { revenue: "$10M", employee_count: null, market_cap: null, yoy_growth: "+5%" },
      risks: ["Rising competition."],
    }
    render(<ReportView companyName="Acme" sections={sections} sectionStatus={doneStatus} overviewDraft="" />)

    expect(screen.getByText("Acme makes widgets.")).toBeInTheDocument()
    expect(screen.getByText("Jane Doe")).toBeInTheDocument()
    expect(screen.getByText("CEO")).toBeInTheDocument()
    expect(screen.getByText("Acme launched a new product.")).toBeInTheDocument()
    expect(screen.getByText("$10M")).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBe(2) // employee_count and market_cap are null
    expect(screen.getByText("Rising competition.")).toBeInTheDocument()
  })

  it("shows the empty-section message when a completed section has no data", () => {
    render(<ReportView companyName="Acme" sections={{ news: [] }} sectionStatus={doneStatus} overviewDraft="" />)
    expect(screen.getByText("No recent news found.")).toBeInTheDocument()
  })

  it("streams the overview draft live while that section is active", () => {
    const activeStatus: Record<SectionKey, SectionStatus> = { ...doneStatus, overview: "active" }
    render(
      <ReportView
        companyName="Acme"
        sections={{}}
        sectionStatus={activeStatus}
        overviewDraft="Acme is a comp"
      />,
    )
    expect(screen.getByText(/Acme is a comp/)).toBeInTheDocument()
  })
})
