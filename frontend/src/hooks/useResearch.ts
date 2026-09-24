import { useCallback, useEffect, useReducer, useRef } from "react"
import { ApiError, streamResearch } from "../api/client"
import type { ReportSections, SectionKey, SectionStatus } from "../types"

export type ResearchPhase = "idle" | "streaming" | "complete" | "error"

export interface ResearchState {
  phase: ResearchPhase
  companyName: string | null
  statusMessage: string | null
  sectionStatus: Record<SectionKey, SectionStatus>
  sections: Partial<ReportSections>
  overviewDraft: string
  errorMessage: string | null
  reportId: number | null
}

const idleSectionStatus: Record<SectionKey, SectionStatus> = {
  overview: "pending",
  key_people: "pending",
  news: "pending",
  financials: "pending",
  risks: "pending",
}

const initialState: ResearchState = {
  phase: "idle",
  companyName: null,
  statusMessage: null,
  sectionStatus: idleSectionStatus,
  sections: {},
  overviewDraft: "",
  errorMessage: null,
  reportId: null,
}

type Action =
  | { type: "start"; companyName: string }
  | { type: "status"; message: string }
  | { type: "section_start"; section: SectionKey }
  | { type: "token"; section: SectionKey; text: string }
  | { type: "section_complete"; section: SectionKey; data: unknown }
  | { type: "done"; reportId: number }
  | { type: "error"; message: string }
  | { type: "reset" }

function reducer(state: ResearchState, action: Action): ResearchState {
  switch (action.type) {
    case "start":
      return {
        ...initialState,
        phase: "streaming",
        companyName: action.companyName,
        statusMessage: `Starting research on ${action.companyName}…`,
      }
    case "status":
      return { ...state, statusMessage: action.message }
    case "section_start":
      return {
        ...state,
        sectionStatus: { ...state.sectionStatus, [action.section]: "active" },
      }
    case "token":
      if (action.section !== "overview") return state
      return { ...state, overviewDraft: state.overviewDraft + action.text }
    case "section_complete":
      return {
        ...state,
        sectionStatus: { ...state.sectionStatus, [action.section]: "done" },
        sections: { ...state.sections, [action.section]: action.data } as Partial<ReportSections>,
      }
    case "done":
      return { ...state, phase: "complete", statusMessage: null, reportId: action.reportId }
    case "error":
      return { ...state, phase: "error", statusMessage: null, errorMessage: action.message }
    case "reset":
      return initialState
    default:
      return state
  }
}

export function useResearch() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const start = useCallback(async (companyNameRaw: string) => {
    const companyName = companyNameRaw.trim()
    if (!companyName) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    dispatch({ type: "start", companyName })

    try {
      await streamResearch(
        companyName,
        (event) => {
          switch (event.event) {
            case "status":
              dispatch({ type: "status", message: event.data.message })
              break
            case "section_start":
              dispatch({ type: "section_start", section: event.data.section })
              break
            case "token":
              dispatch({ type: "token", section: event.data.section, text: event.data.text })
              break
            case "section_complete":
              dispatch({
                type: "section_complete",
                section: event.data.section,
                data: event.data.data,
              })
              break
            case "done":
              dispatch({ type: "done", reportId: event.data.report_id })
              break
            case "error":
              dispatch({ type: "error", message: event.data.message })
              break
            case "research_complete":
              break
          }
        },
        controller.signal,
      )
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the research service. Check your connection and try again."
      dispatch({ type: "error", message })
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: "reset" })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: "reset" })
  }, [])

  return { state, start, cancel, reset }
}
