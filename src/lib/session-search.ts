import type { MessageTurn } from "@/lib/types"

/**
 * One search hit inside the rendered conversation thread.
 *
 * `threadIndex` indexes the `threadItems` array in `MessageListView` (the
 * caller passes one turn-list per rendered item), so it feeds
 * `scrollToIndex` directly. `ordinalInItem` is the 0-based position of this
 * hit among all hits within the same thread item — the DOM highlighter uses
 * it to pick the active range inside that item's element.
 */
export interface SessionSearchMatch {
  threadIndex: number
  turnId: string
  blockIndex: number
  offset: number
  ordinalInItem: number
}

export function normalizeSearchQuery(query: string): string {
  return query.trim()
}

/**
 * Case-insensitive, non-overlapping substring search over the text blocks of
 * user/assistant turns. Thinking, tool, image and plan blocks never match;
 * system turns are skipped (they render collapsed, so a hit could not be
 * shown).
 */
export function findSessionMatches(
  itemTurns: ReadonlyArray<readonly MessageTurn[]>,
  query: string
): SessionSearchMatch[] {
  const needle = normalizeSearchQuery(query).toLowerCase()
  if (needle.length === 0) return []

  const matches: SessionSearchMatch[] = []
  for (let threadIndex = 0; threadIndex < itemTurns.length; threadIndex++) {
    let ordinalInItem = 0
    for (const turn of itemTurns[threadIndex]) {
      if (turn.role === "system") continue
      for (let blockIndex = 0; blockIndex < turn.blocks.length; blockIndex++) {
        const block = turn.blocks[blockIndex]
        if (block.type !== "text") continue
        const haystack = block.text.toLowerCase()
        let offset = haystack.indexOf(needle)
        while (offset !== -1) {
          matches.push({
            threadIndex,
            turnId: turn.id,
            blockIndex,
            offset,
            ordinalInItem,
          })
          ordinalInItem += 1
          offset = haystack.indexOf(needle, offset + needle.length)
        }
      }
    }
  }
  return matches
}
