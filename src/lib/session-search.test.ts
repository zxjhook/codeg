import { describe, it, expect } from "vitest"
import {
  findSessionMatches,
  normalizeSearchQuery,
  nextSearchCursor,
  clampSearchCursor,
} from "@/lib/session-search"
import type { MessageTurn } from "@/lib/types"

function turn(
  id: string,
  role: MessageTurn["role"],
  blocks: MessageTurn["blocks"]
): MessageTurn {
  return { id, role, blocks, timestamp: "2026-07-03T00:00:00Z" }
}

describe("normalizeSearchQuery", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSearchQuery("  foo ")).toBe("foo")
  })

  it("collapses whitespace-only input to empty", () => {
    expect(normalizeSearchQuery("   ")).toBe("")
  })
})

describe("findSessionMatches", () => {
  const items: readonly MessageTurn[][] = [
    [turn("u1", "user", [{ type: "text", text: "Hello world" }])],
    [
      turn("a1", "assistant", [
        { type: "thinking", text: "world world" },
        { type: "text", text: "world, and World again" },
        {
          type: "tool_result",
          tool_use_id: "t1",
          output_preview: "world in tool output",
          is_error: false,
        },
      ]),
      turn("a2", "assistant", [{ type: "text", text: "no match here" }]),
    ],
    [], // non-turn thread item (e.g. typing indicator)
    [turn("s1", "system", [{ type: "text", text: "world in system" }])],
  ]

  it("returns empty for empty or whitespace queries", () => {
    expect(findSessionMatches(items, "")).toEqual([])
    expect(findSessionMatches(items, "   ")).toEqual([])
  })

  it("matches case-insensitively across items in order", () => {
    const matches = findSessionMatches(items, "WORLD")
    expect(matches).toEqual([
      {
        threadIndex: 0,
        turnId: "u1",
        blockIndex: 0,
        offset: 6,
        ordinalInItem: 0,
      },
      {
        threadIndex: 1,
        turnId: "a1",
        blockIndex: 1,
        offset: 0,
        ordinalInItem: 0,
      },
      {
        threadIndex: 1,
        turnId: "a1",
        blockIndex: 1,
        offset: 11,
        ordinalInItem: 1,
      },
    ])
  })

  it("skips thinking and tool blocks, and system turns", () => {
    const matches = findSessionMatches(items, "world")
    expect(matches.some((m) => m.turnId === "s1")).toBe(false)
    // a1 has "world" in thinking and tool_result too — only the text block's
    // two occurrences count.
    expect(matches.filter((m) => m.turnId === "a1")).toHaveLength(2)
  })

  it("finds non-overlapping occurrences only", () => {
    const single = [
      [turn("u1", "user", [{ type: "text" as const, text: "aaa" }])],
    ]
    expect(findSessionMatches(single, "aa")).toHaveLength(1)
  })
})

describe("nextSearchCursor", () => {
  it("wraps forward from last index to 0", () => {
    expect(nextSearchCursor(4, 1, 5)).toBe(0)
  })

  it("wraps backward from 0 to last index", () => {
    expect(nextSearchCursor(0, -1, 5)).toBe(4)
  })

  it("returns 0 when total is 0", () => {
    expect(nextSearchCursor(0, 1, 0)).toBe(0)
    expect(nextSearchCursor(0, -1, 0)).toBe(0)
  })

  it("advances normally within bounds", () => {
    expect(nextSearchCursor(2, 1, 5)).toBe(3)
    expect(nextSearchCursor(2, -1, 5)).toBe(1)
  })
})

describe("clampSearchCursor", () => {
  it("clamps cursor when beyond total", () => {
    expect(clampSearchCursor(10, 5)).toBe(4)
  })

  it("is a no-op when cursor is within range", () => {
    expect(clampSearchCursor(3, 5)).toBe(3)
  })

  it("returns 0 when total is 0", () => {
    expect(clampSearchCursor(0, 0)).toBe(0)
    expect(clampSearchCursor(5, 0)).toBe(0)
  })

  it("clamps to last index when cursor equals total", () => {
    expect(clampSearchCursor(5, 5)).toBe(4)
  })
})
