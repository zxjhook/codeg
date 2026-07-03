"use client"

import { useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ConversationSearchBarProps {
  query: string
  onQueryChange: (query: string) => void
  /** 0-based index of the active match; ignored when totalMatches is 0. */
  currentIndex: number
  totalMatches: number
  onNavigate: (direction: 1 | -1) => void
  onClose: () => void
}

/**
 * Floating find-in-conversation bar. Purely presentational: matching,
 * debouncing and scroll live in MessageListView; this only renders the input,
 * the `n/m` counter and prev/next/close controls.
 */
export function ConversationSearchBar({
  query,
  onQueryChange,
  currentIndex,
  totalMatches,
  onNavigate,
  onClose,
}: ConversationSearchBarProps) {
  const t = useTranslations("Folder.chat.searchBar")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const noMatches = query.length > 0 && totalMatches === 0
  const current = totalMatches === 0 ? 0 : currentIndex + 1

  return (
    <div className="pointer-events-auto absolute end-2 top-2 z-30 flex items-center gap-1 rounded-lg border bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onNavigate(e.shiftKey ? -1 : 1)
          } else if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder={t("placeholder")}
        aria-invalid={noMatches || undefined}
        className={cn(
          "h-7 w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
          noMatches && "text-destructive"
        )}
      />
      {query.length > 0 && (
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            noMatches ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {t("matchCount", { current, total: totalMatches })}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("previousMatch")}
        disabled={totalMatches === 0}
        onClick={() => onNavigate(-1)}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("nextMatch")}
        disabled={totalMatches === 0}
        onClick={() => onNavigate(1)}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("close")}
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
