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
 * Marks the fallback path's overlay element. The overlay lives inside each
 * instance's own container, so unlike the highlight registry it needs no
 * cross-instance ownership token.
 */
const OVERLAY_ATTR = "data-search-active-overlay"

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
 * < 17.2, i.e. macOS <= 14.1 WKWebView) it falls back to drawing a positioned
 * overlay box over the ACTIVE match — other matches stay unmarked, but the
 * user still sees where each jump landed. The fallback must never touch the
 * document selection: the search input's caret IS the selection, so stealing
 * it breaks typing.
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
      const container = containerRef.current

      const removeOverlay = () => {
        container
          ?.querySelectorAll(`[${OVERLAY_ATTR}]`)
          .forEach((el) => el.remove())
      }

      if (!container || query.length === 0 || activeItemKey == null) {
        removeOverlay()
        return
      }

      // One overlay layer per container, spanning it fully so child boxes can
      // use container-relative coordinates. pointer-events: none keeps text
      // selection and clicks working underneath.
      let overlay = container.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`)
      if (!overlay) {
        overlay = document.createElement("div")
        overlay.setAttribute(OVERLAY_ATTR, "")
        overlay.style.cssText =
          "position:absolute;inset:0;pointer-events:none;z-index:15;overflow:hidden"
        container.appendChild(overlay)
      }

      let frame: number | null = null
      const apply = () => {
        frame = null
        const layer = overlay
        if (!layer) return
        layer.replaceChildren()
        const { byItemKey } = collectSearchRanges(container, query)
        const group = byItemKey.get(activeItemKey)
        if (!group || group.length === 0) return
        const range = group[Math.min(activeOrdinal, group.length - 1)]
        const containerRect = container.getBoundingClientRect()
        for (const rect of Array.from(range.getClientRects())) {
          const box = document.createElement("div")
          box.style.cssText =
            "position:absolute;border-radius:2px;" +
            "background-color:rgb(249 115 22/0.4);" +
            `top:${rect.top - containerRect.top}px;` +
            `left:${rect.left - containerRect.left}px;` +
            `width:${rect.width}px;height:${rect.height}px`
          layer.appendChild(box)
        }
      }
      const schedule = () => {
        if (frame == null) frame = requestAnimationFrame(apply)
      }

      apply()
      // Reposition when virtua mounts/unmounts rows or streaming reflows the
      // content — but ignore our own overlay writes to avoid an observer loop.
      const observer = new MutationObserver((records) => {
        if (records.every((r) => overlay?.contains(r.target))) return
        schedule()
      })
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      // The inner virtua scroller moves content under the overlay; capture
      // phase catches its scroll events without knowing which element scrolls.
      container.addEventListener("scroll", schedule, true)
      window.addEventListener("resize", schedule)
      return () => {
        observer.disconnect()
        container.removeEventListener("scroll", schedule, true)
        window.removeEventListener("resize", schedule)
        if (frame != null) cancelAnimationFrame(frame)
        removeOverlay()
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
