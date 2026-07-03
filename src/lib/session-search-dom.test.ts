import { describe, it, expect } from "vitest"
import { collectSearchRanges } from "@/lib/session-search-dom"

function buildDom(html: string): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

describe("collectSearchRanges", () => {
  it("collects ranges only inside data-search-text elements", () => {
    const root = buildDom(
      `<div data-thread-key="k1">
        <div data-search-text=""><p>hello World and world</p></div>
        <pre>world in tool output</pre>
      </div>`
    )
    const { all, byItemKey } = collectSearchRanges(root, "world")
    expect(all).toHaveLength(2)
    expect(byItemKey.get("k1")).toHaveLength(2)
    expect(all[0].toString().toLowerCase()).toBe("world")
    root.remove()
  })

  it("groups ranges by their enclosing thread item", () => {
    const root = buildDom(
      `<div data-thread-key="k1"><div data-search-text="">foo</div></div>
       <div data-thread-key="k2"><div data-search-text="">foo foo</div></div>`
    )
    const { byItemKey } = collectSearchRanges(root, "foo")
    expect(byItemKey.get("k1")).toHaveLength(1)
    expect(byItemKey.get("k2")).toHaveLength(2)
    root.remove()
  })

  it("returns empty for empty queries", () => {
    const root = buildDom(
      `<div data-thread-key="k1"><div data-search-text="">foo</div></div>`
    )
    expect(collectSearchRanges(root, "").all).toHaveLength(0)
    root.remove()
  })
})

describe("findActiveSearchRange", () => {
  it("returns the ordinal-th range within the item, clamped", async () => {
    const { findActiveSearchRange } = await import("@/lib/session-search-dom")
    const root = buildDom(
      `<div data-thread-key="k1"><div data-search-text="">world and world</div></div>`
    )
    const second = findActiveSearchRange(root, "world", "k1", 1)
    expect(second?.startOffset).toBe(10)
    const clamped = findActiveSearchRange(root, "world", "k1", 99)
    expect(clamped?.startOffset).toBe(10)
    root.remove()
  })

  it("returns null when the item has no rendered match", async () => {
    const { findActiveSearchRange } = await import("@/lib/session-search-dom")
    const root = buildDom(
      `<div data-thread-key="k1"><div data-search-text="">foo</div></div>`
    )
    expect(findActiveSearchRange(root, "world", "k1", 0)).toBeNull()
    expect(findActiveSearchRange(root, "foo", "missing", 0)).toBeNull()
    root.remove()
  })
})
