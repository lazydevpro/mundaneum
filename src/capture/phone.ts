import { serviceBase } from '../agents/config'
import { useBoard } from '../store'

/**
 * Phone bridge: the QR opens this board's URL with #capture on a phone;
 * photos hop through a tiny ephemeral drop endpoint on the worker (5-minute
 * TTL, cleared on read). Not a sync backend — a mail slot.
 */

export function dropEndpoint(boardId: string): string | null {
  const base = serviceBase()
  return base === null ? null : base + '/drop/' + encodeURIComponent(boardId)
}

export async function sendToDesktop(boardId: string, dataUrl: string): Promise<boolean> {
  const url = dropEndpoint(boardId)
  if (!url) return false
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  })
  return res.ok
}

let pollTimer: ReturnType<typeof setInterval> | undefined

/** One read of the slot; returns how many photos landed. */
export async function collectPhoneDrops(): Promise<number> {
  const url = dropEndpoint(useBoard.getState().boardId)
  if (!url) return 0
  try {
    const res = await fetch(url)
    if (!res.ok) return 0
    const data = (await res.json()) as { images?: string[] }
    if (!data.images?.length) return 0
    const store = useBoard.getState()
    store.addCards(
      data.images.map((image) => ({ content: image, type: 'image' as const, title: 'from phone' })),
      'human',
    )
    store.logActivity('human', data.images.length + ' photo' + (data.images.length > 1 ? 's' : '') + ' from your phone')
    return data.images.length
  } catch {
    return 0 /* mail slot empty or worker asleep — fine */
  }
}

export function startPhonePolling(): void {
  if (!dropEndpoint(useBoard.getState().boardId) || pollTimer) return
  pollTimer = setInterval(() => void collectPhoneDrops(), 2500)
}

export function stopPhonePolling(): void {
  clearInterval(pollTimer)
  pollTimer = undefined
}

/**
 * The natural moment a phone photo should appear is when you put the phone
 * down and look back at the board — so check on focus, not only while the
 * QR dialog happens to be open. One request per return, no polling cost.
 */
export function installPhoneDropListener(): void {
  const check = () => {
    if (document.visibilityState === 'visible') void collectPhoneDrops()
  }
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
}
