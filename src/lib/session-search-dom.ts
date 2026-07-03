export interface CollectedSearchRanges {
  all: Range[]
  /** Ranges grouped by the enclosing `data-thread-key` wrapper. */
  byItemKey: Map<string, Range[]>
}

/**
 * Walk rendered text nodes under `root` and build DOM Ranges for every
 * case-insensitive occurrence of `query`. Only text inside a
 * `[data-search-text]` element participates, so tool output / UI chrome that
 * happens to contain the query is not highlighted. Matches split across
 * multiple text nodes (inline markdown formatting) are skipped.
 */
export function collectSearchRanges(
  root: HTMLElement,
  query: string
): CollectedSearchRanges {
  const needle = query.trim().toLowerCase()
  const all: Range[] = []
  const byItemKey = new Map<string, Range[]>()
  if (needle.length === 0) return { all, byItemKey }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-search-text]")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  })

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent
    if (!text) continue
    const haystack = text.toLowerCase()
    let offset = haystack.indexOf(needle)
    while (offset !== -1) {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + needle.length)
      all.push(range)
      const key = node.parentElement
        ?.closest("[data-thread-key]")
        ?.getAttribute("data-thread-key")
      if (key != null) {
        const group = byItemKey.get(key)
        if (group) group.push(range)
        else byItemKey.set(key, [range])
      }
      offset = haystack.indexOf(needle, offset + needle.length)
    }
  }
  return { all, byItemKey }
}
