import { useEffect, useRef, useState, type FormEvent } from "react"

interface Props {
  onSearch: (companyName: string) => void
  disabled: boolean
}

export function SearchBar({ onSearch, disabled }: Props) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSearch(trimmed)
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Enter a company name… (Ctrl/Cmd+K)"
        aria-label="Company name"
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        {disabled ? "Researching…" : "Research"}
      </button>
    </form>
  )
}
