import { create } from 'zustand'
import { serviceBase } from '../agents/config'
import { useBoard } from '../store'
import { organize } from '../engine/engine'
import { reapplyExtensions } from '../mcp/tools'
import { docBytes, mergeDocs, stripLocalAssets, type SyncDoc } from './doc'

/**
 * Opt-in board sharing. A board is local until someone presses Share, so
 * merely visiting the site never creates server state — that, plus
 * unguessable board ids and the room's own quotas, is the spam story.
 *
 * Sync is pull-merge-push over plain HTTP against one Durable Object per
 * board: on focus, on a slow timer while visible, and shortly after a local
 * change. Not live cursors — this is a research board, and "your changes
 * show up" is the promise, not "I see your mouse".
 */

export type SyncState = 'off' | 'joining' | 'live' | 'error'

interface SyncUi {
  state: SyncState
  detail: string
  lastAt: number
  set(state: SyncState, detail?: string): void
}

export const useSync = create<SyncUi>((set) => ({
  state: 'off',
  detail: '',
  lastAt: 0,
  set: (state, detail = '') => set({ state, detail, lastAt: Date.now() }),
}))

const flagKey = (boardId: string) => 'mundaneum:shared:' + boardId

export function isShared(boardId: string): boolean {
  try {
    return localStorage.getItem(flagKey(boardId)) === '1'
  } catch {
    return false
  }
}

function markShared(boardId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(flagKey(boardId), '1')
    else localStorage.removeItem(flagKey(boardId))
  } catch {
    /* private mode — sync just won't persist its opt-in */
  }
}

function roomUrl(): string | null {
  const base = serviceBase()
  if (base === null) return null
  return base + '/room/' + encodeURIComponent(useBoard.getState().boardId)
}

/** The local board as a shareable document (local-only files stripped). */
export function localDoc(): SyncDoc {
  const s = useBoard.getState()
  return {
    v: 1,
    boardName: s.boardName,
    updatedAt: Date.now(),
    cards: stripLocalAssets(s.cards),
    links: s.links,
    positions: s.positions,
    labels: s.labels,
    strokes: s.strokes,
    annotations: s.annotations,
    prefs: s.prefs,
    agentProviders: s.agentProviders,
    agentTools: s.agentTools,
    deleted: s.deleted,
  }
}

/** Merge someone else's copy into ours. Shared by server sync and tab sync. */
export function applyDoc(doc: SyncDoc): boolean {
  const s = useBoard.getState()
  const before = Object.keys(s.cards).length + Object.keys(s.links).length
  // Merge the server's copy into ours so local-only assets survive.
  const merged = mergeDocs(localDoc(), doc)
  s.replaceBoard({
    boardName: merged.boardName,
    cards: merged.cards,
    links: merged.links,
    positions: merged.positions,
    labels: merged.labels,
    strokes: merged.strokes,
    annotations: merged.annotations,
    agentProviders: merged.agentProviders ?? s.agentProviders,
    agentTools: merged.agentTools ?? s.agentTools,
    deleted: merged.deleted,
    // View preferences are per-device taste — how I like this board to look
    // on my iPad shouldn't reach across and rearrange your desktop.
    prefs: s.prefs,
  })
  // A platform that arrived in this merge has to reach the live provider table
  // and tool registry too, or it sits inert in the store until a reload.
  reapplyExtensions()
  const after = Object.keys(merged.cards).length + Object.keys(merged.links).length
  return after !== before
}

let inFlight = false
let pushTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

/** One pull-merge-push round trip. */
export async function syncNow(): Promise<void> {
  const url = roomUrl()
  const boardId = useBoard.getState().boardId
  if (!url || inFlight || !isShared(boardId)) return
  inFlight = true
  try {
    const doc = localDoc()
    const size = docBytes(doc)
    if (size > 4_000_000) {
      useSync.getState().set('error', 'board too large to share (' + Math.round(size / 1e6) + ' MB)')
      return
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      useSync.getState().set('error', body.error ?? 'sync failed (' + res.status + ')')
      return
    }
    const merged = (await res.json()) as SyncDoc
    const changed = applyDoc(merged)
    useSync.getState().set('live', changed ? 'updated just now' : 'up to date')
    if (changed) void organize()
  } catch (err) {
    useSync.getState().set('error', String(err).slice(0, 80))
  } finally {
    inFlight = false
  }
}

/** Local edits push shortly after they settle. */
function schedulePush(): void {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void syncNow(), 1500)
}

/**
 * Opening someone's link should just show you their board. A plain GET tells
 * us whether this board was ever shared; adopting it is a read, so a visitor
 * still can't bring a room into existence — only pressing Share does that.
 */
export async function joinIfShared(): Promise<boolean> {
  const boardId = useBoard.getState().boardId
  const url = roomUrl()
  if (!url || isShared(boardId)) return false
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const doc = (await res.json()) as SyncDoc
    if (!doc?.cards) return false
    markShared(boardId, true)
    applyDoc(doc)
    useSync.getState().set('live', 'joined a shared board')
    startSync()
    void organize()
    return true
  } catch {
    return false
  }
}

let started = false
export function startSync(): void {
  const boardId = useBoard.getState().boardId
  // serviceBase() is '' for same-origin in production — falsy, but valid.
  if (started || !isShared(boardId) || serviceBase() === null) return
  started = true
  useSync.getState().set('joining', 'connecting…')
  void syncNow()

  let last = snapshot()
  useBoard.subscribe((s) => {
    if (!s.loaded) return
    const now = snapshot()
    if (now !== last) {
      last = now
      schedulePush()
    }
  })

  const onFocus = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  // Not gated on visibility: a board on a second monitor or in a background
  // tab should still catch up. Browsers throttle background timers on their
  // own, which is exactly the rate limiting we'd have written by hand.
  pollTimer = setInterval(() => void syncNow(), 20000)
}

/** Cheap change detector: identity of the collections that travel. */
function snapshot(): string {
  const s = useBoard.getState()
  return [
    Object.keys(s.cards).length,
    Object.keys(s.links).length,
    s.strokes.length,
    s.annotations.length,
    s.labels.length,
    Object.keys(s.deleted).length,
    s.boardName,
  ].join('|')
}

export async function enableSharing(): Promise<boolean> {
  const boardId = useBoard.getState().boardId
  if (serviceBase() === null) return false
  markShared(boardId, true)
  started = false
  startSync()
  await syncNow()
  return useSync.getState().state !== 'error'
}

export function disableSharing(): void {
  markShared(useBoard.getState().boardId, false)
  clearInterval(pollTimer)
  clearTimeout(pushTimer)
  started = false
  useSync.getState().set('off')
}
