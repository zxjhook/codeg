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
