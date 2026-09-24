import type { ReportDetail, ReportSummary, SectionKey } from "../types"

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export type ResearchEvent =
  | { event: "status"; data: { message: string; section?: SectionKey } }
  | { event: "section_start"; data: { section: SectionKey } }
  | { event: "token"; data: { section: SectionKey; text: string } }
  | { event: "section_complete"; data: { section: SectionKey; data: unknown } }
  | { event: "research_complete"; data: Record<string, never> }
  | { event: "done"; data: { report_id: number } }
  | { event: "error"; data: { message: string } }

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
      return body.detail
    }
  } catch {
    // response wasn't JSON — fall through to the generic message below
  }
  return `Request failed (status ${response.status}).`
}

export async function listReports(): Promise<ReportSummary[]> {
  const res = await fetch(`${API_BASE}/api/reports`)
  if (!res.ok) throw new ApiError(await readErrorMessage(res), res.status)
  return res.json() as Promise<ReportSummary[]>
}

export async function getReport(id: number): Promise<ReportDetail> {
  const res = await fetch(`${API_BASE}/api/reports/${id}`)
  if (!res.ok) throw new ApiError(await readErrorMessage(res), res.status)
  return res.json() as Promise<ReportDetail>
}

export async function deleteReport(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reports/${id}`, { method: "DELETE" })
  if (!res.ok) throw new ApiError(await readErrorMessage(res), res.status)
}

function parseSseBlock(block: string): ResearchEvent | null {
  let eventName: string | null = null
  let dataLine: string | null = null
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) eventName = line.slice("event: ".length)
    else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length)
  }
  if (!eventName || dataLine === null) return null
  return { event: eventName, data: JSON.parse(dataLine) } as ResearchEvent
}

/**
 * POST /api/research streams Server-Sent Events. Browsers' EventSource can't
 * issue POST requests, so we read the raw response body ourselves and split
 * it on SSE's blank-line block separator, buffering across chunk boundaries.
 */
export async function streamResearch(
  companyName: string,
  onEvent: (event: ResearchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: companyName }),
    signal,
  })

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }
  if (!response.body) {
    throw new Error("Streaming is not supported in this browser.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() ?? ""
    for (const block of blocks) {
      if (!block.trim()) continue
      const event = parseSseBlock(block)
      if (event) onEvent(event)
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer)
    if (event) onEvent(event)
  }
}
