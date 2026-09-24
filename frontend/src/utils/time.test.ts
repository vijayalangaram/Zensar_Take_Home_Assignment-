import { describe, expect, it } from "vitest"
import { relativeTime } from "./time"

describe("relativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now")
  })

  it("formats minutes ago", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000)
    expect(relativeTime(date.toISOString())).toBe("5 minutes ago")
  })

  it("uses singular units", () => {
    const date = new Date(Date.now() - 60 * 60 * 1000)
    expect(relativeTime(date.toISOString())).toBe("1 hour ago")
  })

  it("falls back to a locale date beyond a week", () => {
    const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    expect(relativeTime(date.toISOString())).toBe(date.toLocaleDateString())
  })
})
