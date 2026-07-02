"use client"

// Provider-owned external-change watcher for open file tabs.
//
// Subscribes to the per-root workspace FS stream of EVERY folder that has
// open file tabs — not just the active one — so a tab keeps receiving
// external-change detection no matter which folder/conversation is active
// and whether the (closed-by-default) aux file tree is mounted.
//
// Performance model (the load-bearing part):
//   • The subscription effect depends ONLY on `watchSignature`, a
//     collision-safe JSON string of the sorted (folderId, rootPath) pairs
//     that currently have open file tabs. Keystrokes churn `fileTabs`
//     every render, but the signature string stays identical, so
//     subscriptions are never torn down/rebuilt on typing — and the
//     backend stream never restarts.
//   • Only the ACTIVE tab is reconciled eagerly (disk read + conflict
//     check). Every other affected tab is batch-marked stale in a single
//     setState with zero disk reads; activating it later refetches via
//     the existing decideLoad stale promotion.
//   • Our own saves echo back as change events. A one-shot etag record
//     per save suppresses the immediate re-mark so switching tabs after
//     an autosave doesn't flash a pointless reload.
import { useEffect, useMemo, type RefObject } from "react"
import { readFileForEdit } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { isImageFile } from "@/lib/language-detect"
import { getWorkspaceStateStore } from "@/hooks/use-workspace-state-store"
import type { FileEditContent } from "@/lib/types"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"

// One divergence between an open dirty buffer and the file on disk.
// Queued FIFO in the provider and surfaced one at a time by the
// external-conflict dialog; keyed/deduped by folderId + path + signature.
export interface WorkspaceExternalConflict {
  folderId: number
  path: string
  diskContent: string
  unsavedContent: string
  // Fingerprint of the disk state (etag) — a repeat announcement for the
  // same divergence is dropped so the dialog never flickers.
  signature: string
}

type FileChangeDecision =
  | { kind: "none" }
  | { kind: "reload"; path: string; latest: FileEditContent }
  | {
      kind: "conflict"
      path: string
      diskContent: string
      unsavedContent: string
      signature: string
    }
  | { kind: "missing"; path: string; error: string }

function normalizeComparePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

// Per-tab disk-vs-buffer resolver. Compares the tab's known etag against
// the latest disk read for the same path. Independent of activation —
// callable for any open file tab. Re-reads the tab from `fileTabsRef`
// after the fetch to guard against close/reopen races during the async
// window. The `reload` decision carries the fetched FileEditContent so
// the caller can write it via applyExternalReload without a second read.
async function resolveFileChangeDecision(
  tabSnapshot: FileWorkspaceTab,
  rootPath: string,
  fileTabsRef: RefObject<FileWorkspaceTab[]>
): Promise<FileChangeDecision> {
  if (tabSnapshot.kind !== "file") return { kind: "none" }
  const path = tabSnapshot.path
  if (!path) return { kind: "none" }
  if (tabSnapshot.loading) return { kind: "none" }

  const tabId = tabSnapshot.id

  const stillSameTab = (): FileWorkspaceTab | null => {
    const latestTab = (fileTabsRef.current ?? []).find((t) => t.id === tabId)
    if (!latestTab || latestTab.kind !== "file") return null
    if (
      normalizeComparePath(latestTab.path ?? "") !== normalizeComparePath(path)
    ) {
      return null
    }
    if (latestTab.loading) return null
    return latestTab
  }

  let latest: FileEditContent | undefined
  try {
    latest = await readFileForEdit(rootPath, path)
  } catch (error) {
    // Disk read failed — most commonly an external delete, but also
    // permission revocation, an exclusive lock, or a transient FS error.
    // Surface this as its own decision: the watcher routes it to
    // rejectFileTab (clean) or markTabsStale (dirty) so the user is never
    // silently shown a buffer that no longer matches disk.
    const latestTab = stillSameTab()
    if (!latestTab) return { kind: "none" }
    return { kind: "missing", path, error: toErrorMessage(error) }
  }
  // Malformed transport response (no payload): treat as inconclusive
  // rather than fabricating a divergence from a missing etag.
  if (!latest) return { kind: "none" }

  const latestTab = stillSameTab()
  if (!latestTab) return { kind: "none" }

  const latestTabEtag = latestTab.etag ?? null
  if (latest.etag === latestTabEtag) return { kind: "none" }

  if (latestTab.isDirty) {
    return {
      kind: "conflict",
      path,
      diskContent: latest.content,
      unsavedContent: latestTab.content,
      signature: latest.etag ?? "",
    }
  }

  return { kind: "reload", path, latest }
}

// True when `tabPath` (folder-relative) is the changed path itself or sits
// under a changed directory. Boundary-safe: walks the tab path's ancestor
// segments and looks each up in the changed set — "/a/foo" never matches a
// change reported for "/a/foobar", and the cost is O(depth), not O(changed).
function tabPathAffected(tabPath: string, changedSet: Set<string>): boolean {
  const normalized = normalizeComparePath(tabPath)
  if (changedSet.has(normalized)) return true
  let slash = normalized.lastIndexOf("/")
  while (slash > 0) {
    if (changedSet.has(normalized.slice(0, slash))) return true
    slash = normalized.lastIndexOf("/", slash - 1)
  }
  return false
}

export interface UseOpenFileTabsWatchParams {
  // Render-scoped tab list — used ONLY to derive the watch signature.
  fileTabs: FileWorkspaceTab[]
  // Latest-state mirrors owned by the provider.
  fileTabsRef: RefObject<FileWorkspaceTab[]>
  activeFileTabIdRef: RefObject<string | null>
  // Render-scoped active tab for the stale-on-activation pass.
  activeFileTab: FileWorkspaceTab | null
  // Folder root resolution (reads the latest folder map through a ref).
  resolveTabFolderPath: (folderId: number) => string | null
  // Unstable render-scoped folder lookup — participates in the signature
  // memo so a folder path change (rename/repath) re-keys subscriptions.
  getFolder: (id: number) => { id: number; path: string } | undefined
  // Provider actions (stable identities).
  openFilePreview: (
    path: string,
    options?: { line?: number; reload?: boolean; folderId?: number }
  ) => Promise<void>
  reloadOpenFileBackground: (folderId: number, path: string) => Promise<void>
  applyExternalReload: (
    folderId: number,
    path: string,
    fetched: FileEditContent
  ) => Promise<void>
  markTabsStale: (folderId: number, path: string) => void
  markTabsStaleBatch: (folderId: number, paths: string[]) => void
  rejectFileTab: (folderId: number, path: string, errorMessage: string) => void
  enqueueExternalConflict: (conflict: WorkspaceExternalConflict) => void
  // One-shot save-echo suppression (owned by the provider's saveFileTab).
  consumeSelfWriteEcho: (folderId: number, path: string) => boolean
}

export function useOpenFileTabsWatch({
  fileTabs,
  fileTabsRef,
  activeFileTabIdRef,
  activeFileTab,
  resolveTabFolderPath,
  getFolder,
  openFilePreview,
  reloadOpenFileBackground,
  applyExternalReload,
  markTabsStale,
  markTabsStaleBatch,
  rejectFileTab,
  enqueueExternalConflict,
  consumeSelfWriteEcho,
}: UseOpenFileTabsWatchParams): void {
  // Collision-safe, stable-by-value signature of the folders to watch.
  // JSON encoding (not join) so no path content can forge a separator.
  // Recomputed per render (cheap O(tabs)); the effect below only re-runs
  // when the RESULTING STRING changes — i.e. when a folder gains its
  // first open file tab, loses its last one, or its root path changes.
  const watchSignature = useMemo(() => {
    const rootByFolder = new Map<number, string>()
    for (const tab of fileTabs) {
      if (tab.kind !== "file" || !tab.path) continue
      if (rootByFolder.has(tab.folderId)) continue
      const root = getFolder(tab.folderId)?.path
      if (!root) continue
      rootByFolder.set(tab.folderId, root)
    }
    const entries = [...rootByFolder.entries()].sort((a, b) => a[0] - b[0])
    return JSON.stringify(entries)
  }, [fileTabs, getFolder])

  useEffect(() => {
    const targets = JSON.parse(watchSignature) as Array<[number, string]>
    if (targets.length === 0) return

    const subscriptions = targets.map(([folderId, rootPath]) => {
      const store = getWorkspaceStateStore(rootPath)
      store.acquire()

      // Per-folder drainer: coalesces envelope bursts via queueMicrotask
      // and a single in-flight loop, mirroring the aux panel's original
      // reconciliation coroutine semantics.
      const pendingPaths = new Set<string>()
      let pendingFullScan = false
      let flushScheduled = false
      let flushPromise: Promise<void> | null = null
      let disposed = false

      const reconcileChanges = async (
        paths: string[],
        fullScan: boolean
      ): Promise<void> => {
        const openFileTabs = (fileTabsRef.current ?? []).filter(
          (t) =>
            t.kind === "file" && t.path && !t.loading && t.folderId === folderId
        )

        const candidates = (() => {
          if (fullScan) return openFileTabs
          const changedSet = new Set(paths.map(normalizeComparePath))
          return openFileTabs.filter(
            (t) => t.path && tabPathAffected(t.path, changedSet)
          )
        })()
        if (candidates.length === 0) return

        // Split by activation FIRST: background tabs cost zero disk reads
        // (batched stale mark), only the tab the user is looking at gets
        // the eager read+resolve treatment.
        const activeId = activeFileTabIdRef.current
        const staleBatch: string[] = []
        const eager: FileWorkspaceTab[] = []
        for (const tab of candidates) {
          if (!tab.path) continue
          if (tab.id === activeId) {
            eager.push(tab)
            continue
          }
          // Clean tab whose etag matches a just-issued save of ours: the
          // event is (with overwhelming likelihood) our own write echo.
          // One-shot: the record is consumed, so any FURTHER event for
          // this path marks stale normally.
          if (!tab.isDirty && consumeSelfWriteEcho(folderId, tab.path)) {
            continue
          }
          staleBatch.push(tab.path)
        }
        if (staleBatch.length > 0) {
          markTabsStaleBatch(folderId, staleBatch)
        }

        for (const tab of eager) {
          if (disposed) return
          const path = tab.path
          if (!path) continue

          // Image tabs do not carry an etag and load via readFileBase64.
          // Bypass the text-file resolver: a single path-match is enough
          // to trigger a refresh.
          if (isImageFile(path)) {
            void reloadOpenFileBackground(folderId, path)
            continue
          }

          if (consumeSelfWriteEcho(folderId, path)) continue

          const rootNow = resolveTabFolderPath(folderId)
          if (!rootNow) continue
          const decision = await resolveFileChangeDecision(
            tab,
            rootNow,
            fileTabsRef
          )
          if (disposed) return

          // Folder-path drift guard: if the folder was re-pathed while the
          // read was in flight, the payload belongs to the OLD root —
          // discard rather than write foreign bytes into the tab.
          if (resolveTabFolderPath(folderId) !== rootNow) continue

          if (decision.kind === "none") continue

          if (decision.kind === "reload") {
            void applyExternalReload(folderId, decision.path, decision.latest)
            continue
          }

          if (decision.kind === "missing") {
            const liveTab = (fileTabsRef.current ?? []).find(
              (t) => t.id === tab.id
            )
            if (liveTab?.isDirty) {
              markTabsStale(folderId, decision.path)
            } else {
              rejectFileTab(folderId, decision.path, decision.error)
            }
            continue
          }

          // Conflict. Re-read activation AFTER the resolve await: if the
          // user switched away mid-read, degrade to a stale mark instead
          // of popping a dialog for a tab they just left.
          if (tab.id === activeFileTabIdRef.current) {
            enqueueExternalConflict({
              folderId,
              path: decision.path,
              diskContent: decision.diskContent,
              unsavedContent: decision.unsavedContent,
              signature: decision.signature,
            })
          } else {
            markTabsStale(folderId, decision.path)
          }
        }
      }

      const ensureFlushing = () => {
        if (flushPromise || flushScheduled) return
        flushScheduled = true
        queueMicrotask(() => {
          flushScheduled = false
          if (disposed) return
          flushPromise = (async () => {
            try {
              // Drain anything pending — including envelopes that arrive
              // while awaiting reconcileChanges; their paths land in
              // pendingPaths and the next loop iteration picks them up.
              while (!disposed && (pendingPaths.size > 0 || pendingFullScan)) {
                const paths = Array.from(pendingPaths)
                pendingPaths.clear()
                const fullScan = pendingFullScan
                pendingFullScan = false
                await reconcileChanges(paths, fullScan)
              }
            } finally {
              flushPromise = null
            }
          })()
        })
      }

      const unsubscribe = store.subscribeEnvelopes(
        ({ changed_paths, kind }) => {
          if (
            kind === "resync_hint" ||
            !changed_paths ||
            changed_paths.length === 0
          ) {
            // Resync or untargeted event — we cannot scope work, so cover
            // every open tab of this folder. Targeted paths from later
            // envelopes are additive (full scan is a superset).
            pendingFullScan = true
          } else {
            for (const path of changed_paths) {
              pendingPaths.add(path)
            }
          }
          ensureFlushing()
        }
      )

      return () => {
        disposed = true
        unsubscribe()
        pendingPaths.clear()
        store.release()
      }
    })

    return () => {
      for (const dispose of subscriptions) dispose()
    }
  }, [
    watchSignature,
    fileTabsRef,
    activeFileTabIdRef,
    resolveTabFolderPath,
    reloadOpenFileBackground,
    applyExternalReload,
    markTabsStale,
    markTabsStaleBatch,
    rejectFileTab,
    enqueueExternalConflict,
    consumeSelfWriteEcho,
  ])

  // Stale-on-activation: when the user switches to (or just opened) a tab
  // the watcher previously flagged stale, resolve it now — without waiting
  // for the next workspace event. Clean stale is promoted to reload by
  // openFilePreview's decideLoad path; this effect covers dirty stale
  // (conflict detection) and the defensive fallback for clean stale that
  // survived activation (e.g. switchFileTab, which bypasses decideLoad).
  useEffect(() => {
    const tab = activeFileTab
    if (!tab || tab.kind !== "file" || !tab.path) return
    if (!tab.stale || tab.loading) return

    if (!tab.isDirty) {
      // Route the reload to the TAB's own folder — the active workspace
      // folder is not necessarily the tab's owner.
      void openFilePreview(tab.path, {
        reload: true,
        folderId: tab.folderId,
      })
      return
    }

    const rootPath = resolveTabFolderPath(tab.folderId)
    if (!rootPath) return
    void (async () => {
      const decision = await resolveFileChangeDecision(
        tab,
        rootPath,
        fileTabsRef
      )
      // Folder-path drift guard (same as the watcher loop).
      if (resolveTabFolderPath(tab.folderId) !== rootPath) return
      if (decision.kind === "conflict") {
        enqueueExternalConflict({
          folderId: tab.folderId,
          path: decision.path,
          diskContent: decision.diskContent,
          unsavedContent: decision.unsavedContent,
          signature: decision.signature,
        })
      } else if (decision.kind === "reload") {
        void applyExternalReload(tab.folderId, decision.path, decision.latest)
      } else if (decision.kind === "missing") {
        // File vanished while the dirty buffer sat in a non-active tab.
        // The buffer is still dirty here (this branch only runs for
        // tab.isDirty === true) so we keep the stale flag on the tab —
        // refusing to silently lose the user's unsaved edits. The user
        // discovers the deletion on save (backend recreates or errors).
        markTabsStale(tab.folderId, decision.path)
      }
    })()
  }, [
    activeFileTab,
    fileTabsRef,
    resolveTabFolderPath,
    openFilePreview,
    applyExternalReload,
    enqueueExternalConflict,
    markTabsStale,
  ])
}
