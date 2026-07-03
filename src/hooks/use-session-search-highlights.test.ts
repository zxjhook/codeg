import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSessionSearchHighlights } from "@/hooks/use-session-search-highlights"

// jsdom has no CSS.highlights / Highlight, so these tests exercise the
// fallback path used by WebKit < 17.2 (macOS <= 14.1 WKWebView): the hook
// selects the active match with the native Selection API instead of painting
// CSS highlights.

function buildContainer(): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = `
    <div data-thread-key="k1">
      <div data-search-text="">hello world and world</div>
    </div>`
  document.body.appendChild(root)
  return root
}

function currentSelection(): Selection {
  const selection = window.getSelection()
  if (!selection) throw new Error("jsdom returned no selection")
  return selection
}

beforeEach(() => {
  document.body.innerHTML = ""
  currentSelection().removeAllRanges()
})

describe("useSessionSearchHighlights selection fallback", () => {
  it("selects the active match when CSS highlights are unavailable", () => {
    const root = buildContainer()
    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 1,
      })
    )
    const selection = currentSelection()
    expect(selection.rangeCount).toBe(1)
    const range = selection.getRangeAt(0)
    expect(range.toString().toLowerCase()).toBe("world")
    // Second occurrence of "world" in "hello world and world".
    expect(range.startOffset).toBe(16)
  })

  it("clamps the active ordinal to the last occurrence", () => {
    const root = buildContainer()
    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 99,
      })
    )
    expect(currentSelection().getRangeAt(0).startOffset).toBe(16)
  })

  it("clears its own selection when the query empties", () => {
    const root = buildContainer()
    const { rerender } = renderHook(
      ({ query }: { query: string }) =>
        useSessionSearchHighlights({
          containerRef: { current: root },
          query,
          activeItemKey: "k1",
          activeOrdinal: 0,
        }),
      { initialProps: { query: "world" } }
    )
    expect(currentSelection().rangeCount).toBe(1)
    rerender({ query: "" })
    expect(currentSelection().rangeCount).toBe(0)
  })

  it("clears its own selection on unmount", () => {
    const root = buildContainer()
    const { unmount } = renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 0,
      })
    )
    expect(currentSelection().rangeCount).toBe(1)
    unmount()
    expect(currentSelection().rangeCount).toBe(0)
  })

  it("does not clobber a selection it did not create", () => {
    const root = buildContainer()
    // A user-made selection elsewhere on the page.
    const userNode = document.createElement("p")
    userNode.textContent = "user selected text"
    document.body.appendChild(userNode)
    const userRange = document.createRange()
    userRange.selectNodeContents(userNode)
    currentSelection().addRange(userRange)

    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "",
        activeItemKey: null,
        activeOrdinal: 0,
      })
    )
    expect(currentSelection().rangeCount).toBe(1)
    expect(currentSelection().getRangeAt(0).toString()).toBe(
      "user selected text"
    )
  })
})
