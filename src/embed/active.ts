import { create } from 'zustand'

/**
 * Live-embed budget. Faces are free; real iframes / <video> / 3D viewers are
 * not. At most MAX_LIVE embeds run at once — activating another deactivates
 * the least-recently-used back to its face. This is what lets "everything is
 * embeddable" coexist with a 150-card canvas.
 */

export const MAX_LIVE = 12

interface ActiveState {
  live: string[] // card ids, most recent last
  activate(id: string): void
  deactivate(id: string): void
  isLive(id: string): boolean
}

export const useActive = create<ActiveState>((set, get) => ({
  live: [],
  activate(id) {
    const cur = get().live.filter((x) => x !== id)
    cur.push(id)
    set({ live: cur.slice(-MAX_LIVE) })
  },
  deactivate(id) {
    set({ live: get().live.filter((x) => x !== id) })
  },
  isLive(id) {
    return get().live.includes(id)
  },
}))
