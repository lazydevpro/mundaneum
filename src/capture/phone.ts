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

export function startPhonePolling(): void {
  const boardId = useBoard.getState().boardId
  const url = dropEndpoint(boardId)
  if (!url || pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const data = (await res.json()) as { images?: string[] }
      if (data.images?.length) {
        useBoard.getState().addCards(
          data.images.map((image) => ({ content: image, type: 'image' as const, title: 'from phone' })),
          'human',
        )
      }
    } catch {
      /* mail slot empty or worker asleep — fine */
    }
  }, 2500)
}

export function stopPhonePolling(): void {
  clearInterval(pollTimer)
  pollTimer = undefined
}
