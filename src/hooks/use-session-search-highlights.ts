"use client"

import { useEffect, type RefObject } from "react"
import { collectSearchRanges } from "@/lib/session-search-dom"

const MATCH_HIGHLIGHT = "codeg-search-match"
const ACTIVE_HIGHLIGHT = "codeg-search-active"

/**
 * Inject ::highlight() CSS rules at runtime. Turbopack's CSS parser rejects
 * the pseudo-element at build time, so we cannot put these in globals.css.
 * The sheet is created once and reused across hook instances.
 */
let _highlightStyleInjected = false
function ensureHighlightStyles(): void {
  if (_highlightStyleInjected) return
  _highlightStyleInjected = true
  const style = document.createElement("style")
  // Use a string literal split to prevent any static CSS parser from
  // seeing ::highlight and choking on it.
  style.textContent = [
    `::${"highlight"}(${MATCH_HIGHLIGHT}){background-color:rgb(250 204 21/0.35)}`,
    `::${"highlight"}(${ACTIVE_HIGHLIGHT}){background-color:rgb(249 115 22/0.8);color:rgb(255 255 255)}`,
  ].join("\n")
  document.head.appendChild(style)
}

interface UseSessionSearchHighlightsArgs {
  containerRef: RefObject<HTMLElement | null>
  /** Normalized query; pass "" to clear all highlights. */
  query: string
  /** `data-thread-key` of the thread item holding the active match. */
  activeItemKey: string | null
  /** 0-based ordinal of the active match within that item (clamped). */
  activeOrdinal: number
}

function highlightsSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  )
}

/**
 * Paints search-hit highlights over the virtualized message list using the
 * CSS Custom Highlight API. Ranges are recomputed from the live DOM on every
 * relevant mutation (virtua mounts/unmounts rows while scrolling), coalesced
 * to one repaint per animation frame. Silently does nothing when the API is
 * unavailable — search then degrades to scroll-only.
 */
export function useSessionSearchHighlights({
  containerRef,
  query,
  activeItemKey,
  activeOrdinal,
}: UseSessionSearchHighlightsArgs): void {
  useEffect(() => {
    if (!highlightsSupported()) return
    ensureHighlightStyles()
    const container = containerRef.current
    const clear = () => {
      CSS.highlights.delete(MATCH_HIGHLIGHT)
      CSS.highlights.delete(ACTIVE_HIGHLIGHT)
    }
    if (!container || query.length === 0) {
      clear()
      return
    }

    let frame: number | null = null
    const apply = () => {
      frame = null
      clear()
      const { all, byItemKey } = collectSearchRanges(container, query)
      if (all.length === 0) return
      let activeRange: Range | null = null
      if (activeItemKey != null) {
        const group = byItemKey.get(activeItemKey)
        if (group && group.length > 0) {
          activeRange = group[Math.min(activeOrdinal, group.length - 1)]
        }
      }
      CSS.highlights.set(
        MATCH_HIGHLIGHT,
        new Highlight(...all.filter((r) => r !== activeRange))
      )
      if (activeRange) {
        CSS.highlights.set(ACTIVE_HIGHLIGHT, new Highlight(activeRange))
      }
    }
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(apply)
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      observer.disconnect()
      if (frame != null) cancelAnimationFrame(frame)
      clear()
    }
  }, [containerRef, query, activeItemKey, activeOrdinal])
}
