import type { ReactNode } from "react"
import type { Financials, KeyPerson, ReportSections, SectionKey, SectionStatus } from "../types"

interface Props {
  companyName: string
  sections: Partial<ReportSections>
  sectionStatus: Record<SectionKey, SectionStatus>
  overviewDraft: string
}

const SECTION_META: Record<SectionKey, { title: string; icon: string }> = {
  overview: { title: "Company Overview", icon: "🏢" },
  key_people: { title: "Key People", icon: "👤" },
  news: { title: "Recent News", icon: "📰" },
  financials: { title: "Financial Highlights", icon: "📊" },
  risks: { title: "Risk Factors", icon: "⚠️" },
}

export function ReportView({ companyName, sections, sectionStatus, overviewDraft }: Props) {
  return (
    <div className="report-view">
      <h2 className="report-title">{companyName}</h2>

      <Section section="overview" status={sectionStatus.overview}>
        {sectionStatus.overview === "done" ? (
          <p className="overview-text">{sections.overview}</p>
        ) : sectionStatus.overview === "active" ? (
          <p className="overview-text">
            {overviewDraft}
            <span className="cursor" aria-hidden />
          </p>
        ) : null}
      </Section>

      <Section section="key_people" status={sectionStatus.key_people}>
        <KeyPeopleList people={sections.key_people} />
      </Section>

      <Section section="news" status={sectionStatus.news}>
        <BulletList items={sections.news} emptyText="No recent news found." />
      </Section>

      <Section section="financials" status={sectionStatus.financials}>
        <FinancialsGrid financials={sections.financials} />
      </Section>

      <Section section="risks" status={sectionStatus.risks}>
        <BulletList items={sections.risks} emptyText="No notable risks surfaced." />
      </Section>
    </div>
  )
}

function Section({
  section,
  status,
  children,
}: {
  section: SectionKey
  status: SectionStatus
  children: ReactNode
}) {
  const meta = SECTION_META[section]
  return (
    <section className="report-section" data-status={status}>
      <h3 className="section-header">
        <span aria-hidden>{meta.icon}</span> {meta.title}
        {status === "active" && <span className="section-spinner" aria-label="Researching" />}
      </h3>
      {status === "pending" ? <p className="pending-text">Waiting…</p> : children}
    </section>
  )
}

function KeyPeopleList({ people }: { people?: KeyPerson[] }) {
  if (!people || people.length === 0) {
    return <p className="empty-text">No key executives found.</p>
  }
  return (
    <ul className="people-list">
      {people.map((person) => (
        <li key={`${person.name}-${person.title}`}>
          <span className="person-name">{person.name}</span>
          <span className="person-title">{person.title}</span>
        </li>
      ))}
    </ul>
  )
}

function BulletList({ items, emptyText }: { items?: string[]; emptyText: string }) {
  if (!items || items.length === 0) {
    return <p className="empty-text">{emptyText}</p>
  }
  return (
    <ul className="bullet-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function FinancialsGrid({ financials }: { financials?: Financials }) {
  const rows: [string, string | null | undefined][] = [
    ["Revenue", financials?.revenue],
    ["Employees", financials?.employee_count],
    ["Market Cap", financials?.market_cap],
    ["YoY Growth", financials?.yoy_growth],
  ]
  return (
    <dl className="financials-grid">
      {rows.map(([label, value]) => (
        <div className="financials-row" key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  )
}
