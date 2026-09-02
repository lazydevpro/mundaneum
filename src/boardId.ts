/** Board identity lives in the URL hash; state lives in IndexedDB. No accounts. */

export function newId(prefix = ''): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return prefix + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

export function currentBoardId(): string {
  const m = location.hash.match(/b=([a-z0-9-]+)/i)
  // A bare origin is an explicit request for a fresh board. Remembering the
  // previous id made every new tab silently reopen the same board instead.
  const id = m?.[1] ?? newId()
  if (!m) {
    const h = new URLSearchParams(location.hash.slice(1))
    h.set('b', id)
    history.replaceState(null, '', '#' + h.toString())
  }
  try {
    localStorage.setItem('mundaneum:last-board', id)
  } catch {
    /* private mode */
  }
  return id
}

/**
 * The board lives in the fragment, and changing a fragment doesn't reload —
 * so following a link to another board, or editing the id by hand, would
 * otherwise leave the old board running and quietly save edits into it.
 */
export function watchBoardChanges(currentId: string): void {
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/b=([a-z0-9-]+)/i)
    if (m && m[1] !== currentId) location.reload()
  })
}

export function boardUrl(id: string, extra?: Record<string, string>): string {
  const h = new URLSearchParams()
  h.set('b', id)
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return location.origin + location.pathname + '#' + h.toString()
}

export function hashFlag(name: string): string | null {
  const h = new URLSearchParams(location.hash.slice(1))
  return h.get(name)
}
