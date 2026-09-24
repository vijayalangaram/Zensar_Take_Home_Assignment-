import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, deleteReport, getReport, listReports, streamResearch } from "./client"
import type { ResearchEvent } from "./client"

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function streamingResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  const encoded = chunks.map((chunk) => encoder.encode(chunk))
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (index < encoded.length) {
            return { value: encoded[index++], done: false }
          }
          return { value: undefined, done: true }
        },
      }),
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("listReports / getReport / deleteReport", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([{ id: 1, company_name: "Acme", created_at: "now" }]),
      ),
    )
    const reports = await listReports()
    expect(reports).toHaveLength(1)
    expect(reports[0].company_name).toBe("Acme")
  })

  it("throws an ApiError carrying the server's detail message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Report not found." }, 404)))
    await expect(getReport(1)).rejects.toMatchObject({ message: "Report not found.", status: 404 })
  })

  it("propagates delete failures as ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "nope" }, 500)))
    await expect(deleteReport(1)).rejects.toBeInstanceOf(ApiError)
  })
})

describe("streamResearch", () => {
  it("parses SSE events even when a chunk boundary splits an event mid-way", async () => {
    const full =
      'event: status\ndata: {"message": "hi"}\n\n' +
      'event: section_complete\ndata: {"section": "overview", "data": "text"}\n\n' +
      'event: done\ndata: {"report_id": 7}\n\n'
    const splitPoint = 30
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(streamingResponse([full.slice(0, splitPoint), full.slice(splitPoint)])),
    )

    const events: ResearchEvent[] = []
    await streamResearch("Acme", (event) => events.push(event), new AbortController().signal)

    expect(events.map((event) => event.event)).toEqual(["status", "section_complete", "done"])
    expect(events[2].data).toEqual({ report_id: 7 })
  })

  it("rejects with an ApiError when the initial response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Please enter a valid company name." }, 422)),
    )
    await expect(
      streamResearch("??", () => {}, new AbortController().signal),
    ).rejects.toMatchObject({ status: 422 })
  })
})
