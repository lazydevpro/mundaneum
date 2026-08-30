import { useBoard } from '../store'
import { organize } from '../engine/engine'
import { applyDoc, localDoc } from './sync'
import type { SyncDoc } from './doc'

/**
 * Same-machine, same-browser tab sync — no server, no network.
 *
 * Two tabs on one board each hold their own copy in memory and each write it
 * back to IndexedDB, so without this the second save silently clobbers the
 * first. BroadcastChannel gives every tab on this origin the same edits
 * instantly, and the merge is the one used everywhere else, so a tab that
 * was asleep still converges instead of overwriting.
 *
 * This works whether or not the board is shared, because it never leaves the
 * machine. It cannot reach a *different* browser (ChatGPT desktop's browser
 * and Chrome have separate storage) — that is what sharing is for.
 */

let channel: BroadcastChannel | null = null
let applying = false
let sendTimer: ReturnType<typeof setTimeout> | undefined

interface Wire {
  from: string
  doc: SyncDoc
}

// Distinguishes our own echoes from a sibling tab's messages.
const tabId = Math.random().toString(36).slice(2)

export function startLocalSync(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  const boardId = useBoard.getState().boardId
  channel = new BroadcastChannel('mundaneum:' + boardId)

  channel.onmessage = (e: MessageEvent<Wire>) => {
    const msg = e.data
    if (!msg?.doc || msg.from === tabId) return
    applying = true
    try {
      const changed = applyDoc(msg.doc)
      if (changed) void organize()
    } finally {
      // Let the store settle before we listen for our own changes again.
      setTimeout(() => {
        applying = false
      }, 0)
    }
  }

  let last = fingerprint()
  useBoard.subscribe((s) => {
    if (!s.loaded || applying) return
    const now = fingerprint()
    if (now === last) return
    last = now
    clearTimeout(sendTimer)
    sendTimer = setTimeout(() => {
      channel?.postMessage({ from: tabId, doc: localDoc() } satisfies Wire)
    }, 250)
  })
}

/** Cheap change detector over the parts that travel. */
function fingerprint(): string {
  const s = useBoard.getState()
  return [
    Object.keys(s.cards).length,
    Object.keys(s.links).length,
    s.strokes.length,
    s.annotations.length,
    s.labels.length,
    Object.keys(s.deleted).length,
    s.boardName,
    // catches edits that don't change counts (text, accept, move)
    Object.values(s.cards).reduce((a, c) => a + (c.updatedAt ?? c.addedAt), 0),
  ].join('|')
}

export function stopLocalSync(): void {
  channel?.close()
  channel = null
}
