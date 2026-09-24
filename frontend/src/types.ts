export interface KeyPerson {
  name: string
  title: string
}

export interface Financials {
  revenue: string | null
  employee_count: string | null
  market_cap: string | null
  yoy_growth: string | null
}

export interface ReportSections {
  overview: string
  key_people: KeyPerson[]
  news: string[]
  financials: Financials
  risks: string[]
}

export type SectionKey = keyof ReportSections

export const SECTION_ORDER: SectionKey[] = [
  "overview",
  "key_people",
  "news",
  "financials",
  "risks",
]

export interface ReportSummary {
  id: number
  company_name: string
  created_at: string
}

export interface ReportDetail extends ReportSummary, ReportSections {}

export type SectionStatus = "pending" | "active" | "done"
