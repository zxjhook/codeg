"use client"

import { useEffect, useRef, type RefObject } from "react"
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

/**
 * Module-level ownership token. Only the instance that painted the most recent
 * highlights holds a reference here. This prevents multiple mounted
 * MessageListView instances (inactive tabs, tiled mode, sub-agent dialogs) from
 * stomping on each other's highlights when clearing.
 */
let registryOwner: symbol | null = null

/**
 * Ownership token for the fallback path's document selection, mirroring
 * `registryOwner`: only the instance that last selected a match may clear the
 * selection, so a user-made text selection is never clobbered by an idle
 * hook instance.
 */
let selectionOwner: symbol | null = null

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
 * to one repaint per animation frame. When the API is unavailable (WebKit
 * < 17.2, i.e. macOS <= 14.1 WKWebView) it falls back to selecting the ACTIVE
 * match with the native Selection API — other matches stay unmarked, but the
 * user still sees where each jump landed.
 *
 * Ownership: only the instance currently painting highlights may clear the
 * registry. Instances with an empty query never touch the registry unless they
 * are the current owner (i.e. they painted before the query was cleared).
 */
export function useSessionSearchHighlights({
  containerRef,
  query,
  activeItemKey,
  activeOrdinal,
}: UseSessionSearchHighlightsArgs): void {
  // Each hook instance gets its own stable identity token.
  const tokenRef = useRef<symbol>(Symbol())

  useEffect(() => {
    if (!highlightsSupported()) {
      const token = tokenRef.current
      const container = containerRef.current

      const clearSelectionIfOwner = () => {
        if (selectionOwner === token) {
          window.getSelection()?.removeAllRanges()
          selectionOwner = null
        }
      }

      if (!container || query.length === 0 || activeItemKey == null) {
        clearSelectionIfOwner()
        return
      }

      let frame: number | null = null
      let attempts = 0
      const applySelection = () => {
        frame = null
        const { byItemKey } = collectSearchRanges(container, query)
        const group = byItemKey.get(activeItemKey)
        if (group && group.length > 0) {
          const range = group[Math.min(activeOrdinal, group.length - 1)]
          const selection = window.getSelection()
          if (selection) {
            selectionOwner = token
            selection.removeAllRanges()
            selection.addRange(range)
          }
          return
        }
        // Right after scrollToIndex the virtualized target row may not be
        // mounted yet; retry across a few frames until it appears.
        if (attempts < 30) {
          attempts += 1
          frame = requestAnimationFrame(applySelection)
        }
      }
      applySelection()
      return () => {
        if (frame != null) cancelAnimationFrame(frame)
        clearSelectionIfOwner()
      }
    }
    ensureHighlightStyles()

    const token = tokenRef.current
    const container = containerRef.current

    const clearIfOwner = () => {
      if (registryOwner === token) {
        CSS.highlights.delete(MATCH_HIGHLIGHT)
        CSS.highlights.delete(ACTIVE_HIGHLIGHT)
        registryOwner = null
      }
    }

    if (!container || query.length === 0) {
      clearIfOwner()
      return
    }

    let frame: number | null = null
    const apply = () => {
      frame = null
      // Take ownership before writing to the registry.
      registryOwner = token
      CSS.highlights.delete(MATCH_HIGHLIGHT)
      CSS.highlights.delete(ACTIVE_HIGHLIGHT)
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
      clearIfOwner()
    }
  }, [containerRef, query, activeItemKey, activeOrdinal])
}
