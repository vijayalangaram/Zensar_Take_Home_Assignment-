import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SearchBar } from "./SearchBar"

describe("SearchBar", () => {
  it("calls onSearch with the trimmed value on submit", async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} disabled={false} />)

    await userEvent.type(screen.getByLabelText("Company name"), "  Acme Corp  ")
    await userEvent.click(screen.getByRole("button", { name: "Research" }))

    expect(onSearch).toHaveBeenCalledWith("Acme Corp")
  })

  it("does not call onSearch for blank input", async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} disabled={false} />)

    await userEvent.click(screen.getByRole("button", { name: "Research" }))

    expect(onSearch).not.toHaveBeenCalled()
  })

  it("disables the input and button while a search is in progress", () => {
    render(<SearchBar onSearch={vi.fn()} disabled={true} />)

    expect(screen.getByLabelText("Company name")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Researching…" })).toBeDisabled()
  })
})
