import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSessionSearchHighlights } from "@/hooks/use-session-search-highlights"

// jsdom has no CSS.highlights / Highlight, so these tests exercise the
// fallback path used by WebKit < 17.2 (macOS <= 14.1 WKWebView): the hook
// draws a positioned overlay box over the active match. It must never touch
// the document selection — the search input's caret IS the selection, so
// stealing it breaks typing.

const OVERLAY_SELECTOR = "[data-search-active-overlay]"

function buildContainer(): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = `
    <div data-thread-key="k1">
      <div data-search-text="">hello world and world</div>
    </div>`
  document.body.appendChild(root)
  return root
}

// jsdom does no layout: getClientRects always returns an empty list. Stub a
// single rect so the overlay path has geometry to draw.
function stubRangeRects(): void {
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([
    { top: 40, left: 12, width: 50, height: 16 },
  ] as unknown as DOMRectList)
}

beforeEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useSessionSearchHighlights overlay fallback", () => {
  it("draws an overlay box over the active match", () => {
    stubRangeRects()
    const root = buildContainer()
    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 1,
      })
    )
    const overlay = root.querySelector<HTMLElement>(OVERLAY_SELECTOR)
    expect(overlay).not.toBeNull()
    const box = overlay!.firstElementChild as HTMLElement
    expect(box).not.toBeNull()
    // Container rect is all zeros in jsdom, so box coords equal the rect's.
    expect(box.style.top).toBe("40px")
    expect(box.style.left).toBe("12px")
    expect(box.style.width).toBe("50px")
    expect(box.style.height).toBe("16px")
  })

  it("never touches the document selection", () => {
    stubRangeRects()
    const root = buildContainer()
    const removeSpy = vi.spyOn(Selection.prototype, "removeAllRanges")
    const addSpy = vi.spyOn(Selection.prototype, "addRange")
    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 0,
      })
    )
    expect(removeSpy).not.toHaveBeenCalled()
    expect(addSpy).not.toHaveBeenCalled()
  })

  it("removes the overlay when the query empties", () => {
    stubRangeRects()
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
    expect(root.querySelector(OVERLAY_SELECTOR)).not.toBeNull()
    rerender({ query: "" })
    expect(root.querySelector(OVERLAY_SELECTOR)).toBeNull()
  })

  it("removes the overlay on unmount", () => {
    stubRangeRects()
    const root = buildContainer()
    const { unmount } = renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "k1",
        activeOrdinal: 0,
      })
    )
    expect(root.querySelector(OVERLAY_SELECTOR)).not.toBeNull()
    unmount()
    expect(root.querySelector(OVERLAY_SELECTOR)).toBeNull()
  })

  it("draws no box when the active item has no rendered match", () => {
    stubRangeRects()
    const root = buildContainer()
    renderHook(() =>
      useSessionSearchHighlights({
        containerRef: { current: root },
        query: "world",
        activeItemKey: "missing-item",
        activeOrdinal: 0,
      })
    )
    const overlay = root.querySelector<HTMLElement>(OVERLAY_SELECTOR)
    expect(overlay?.childElementCount ?? 0).toBe(0)
  })
})
