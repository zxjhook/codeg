import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ConversationSearchBar } from "./conversation-search-bar"

// Key-verbatim stub, except `matchCount` renders its params so the visible
// "current/total" counter can be asserted.
const { stableT } = vi.hoisted(() => {
  const t = (key: string, values?: Record<string, unknown>) =>
    key === "matchCount" && values ? `${values.current}/${values.total}` : key
  return { stableT: t }
})
vi.mock("next-intl", () => ({ useTranslations: () => stableT }))

function setup(
  overrides: Partial<Parameters<typeof ConversationSearchBar>[0]> = {}
) {
  const props = {
    query: "foo",
    onQueryChange: vi.fn(),
    currentIndex: 1,
    totalMatches: 5,
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ConversationSearchBar {...props} />)
  return props
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("ConversationSearchBar", () => {
  it("autofocuses the input and shows a 1-based match count", () => {
    setup()
    const input = screen.getByPlaceholderText("placeholder")
    expect(document.activeElement).toBe(input)
    expect(screen.getByText("2/5")).toBeTruthy()
  })

  it("shows 0/0 and flags the input when nothing matches", () => {
    setup({ totalMatches: 0, currentIndex: 0 })
    expect(screen.getByText("0/0")).toBeTruthy()
    expect(
      screen.getByPlaceholderText("placeholder").getAttribute("aria-invalid")
    ).toBe("true")
  })

  it("hides the count while the query is empty", () => {
    setup({ query: "", totalMatches: 0 })
    expect(screen.queryByText("0/0")).toBeNull()
  })

  it("propagates typed input", () => {
    const props = setup()
    fireEvent.change(screen.getByPlaceholderText("placeholder"), {
      target: { value: "bar" },
    })
    expect(props.onQueryChange).toHaveBeenCalledWith("bar")
  })

  it("navigates with Enter / Shift+Enter and the arrow buttons", () => {
    const props = setup()
    const input = screen.getByPlaceholderText("placeholder")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(props.onNavigate).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(props.onNavigate).toHaveBeenLastCalledWith(-1)
    fireEvent.click(screen.getByLabelText("previousMatch"))
    expect(props.onNavigate).toHaveBeenLastCalledWith(-1)
    fireEvent.click(screen.getByLabelText("nextMatch"))
    expect(props.onNavigate).toHaveBeenLastCalledWith(1)
  })

  it("closes on Escape and via the close button", () => {
    const props = setup()
    fireEvent.keyDown(screen.getByPlaceholderText("placeholder"), {
      key: "Escape",
    })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText("close"))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })
})
