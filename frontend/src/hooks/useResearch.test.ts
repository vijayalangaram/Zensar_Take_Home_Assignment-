import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import * as client from "../api/client"
import { useResearch } from "./useResearch"

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client")
  return { ...actual, streamResearch: vi.fn() }
})

const mockedStreamResearch = vi.mocked(client.streamResearch)

describe("useResearch", () => {
  it("progresses through status, section, and done events", async () => {
    mockedStreamResearch.mockImplementation(async (_name, onEvent) => {
      onEvent({ event: "status", data: { message: "Starting…" } })
      onEvent({ event: "section_start", data: { section: "overview" } })
      onEvent({ event: "token", data: { section: "overview", text: "Hello" } })
      onEvent({ event: "section_complete", data: { section: "overview", data: "Hello world" } })
      onEvent({ event: "done", data: { report_id: 42 } })
    })

    const { result } = renderHook(() => useResearch())
    await act(async () => {
      await result.current.start("Acme")
    })

    expect(result.current.state.phase).toBe("complete")
    expect(result.current.state.reportId).toBe(42)
    expect(result.current.state.sectionStatus.overview).toBe("done")
    expect(result.current.state.sections.overview).toBe("Hello world")
  })

  it("surfaces a rejected stream as an error state", async () => {
    mockedStreamResearch.mockRejectedValue(new client.ApiError("boom", 500))

    const { result } = renderHook(() => useResearch())
    await act(async () => {
      await result.current.start("Acme")
    })

    expect(result.current.state.phase).toBe("error")
    expect(result.current.state.errorMessage).toBe("boom")
  })

  it("ignores the rejection caused by its own cancel/abort", async () => {
    mockedStreamResearch.mockImplementation(
      (_name, _onEvent, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        }),
    )

    const { result } = renderHook(() => useResearch())
    let startPromise!: Promise<void>
    act(() => {
      startPromise = result.current.start("Acme")
    })
    act(() => {
      result.current.cancel()
    })
    await act(async () => {
      await startPromise
    })

    expect(result.current.state.phase).toBe("idle")
    expect(result.current.state.errorMessage).toBeNull()
  })

  it("aborts any in-flight request when the component unmounts", () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort")
    mockedStreamResearch.mockImplementation(() => new Promise(() => {}))

    const { result, unmount } = renderHook(() => useResearch())
    act(() => {
      void result.current.start("Acme")
    })
    unmount()

    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })
})
