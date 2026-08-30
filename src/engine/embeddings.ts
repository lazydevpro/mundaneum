import type { Card } from '../types'

/** Main-thread client for the embedding worker, with a content-hash cache. */

const worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
const pending = new Map<number, Pending>()
let reqSeq = 1

export const embedEvents = new EventTarget()

worker.onmessage = (e) => {
  const msg = e.data as { kind: string; reqId?: number; message?: string; pct?: number }
  if (msg.kind === 'progress') {
    embedEvents.dispatchEvent(new CustomEvent('progress', { detail: msg.pct }))
    return
  }
  const p = msg.reqId ? pending.get(msg.reqId) : undefined
  if (!p) return
  pending.delete(msg.reqId!)
  if (msg.kind === 'error') p.reject(new Error(msg.message))
  else p.resolve(e.data)
}

function call<T>(kind: 'warm' | 'embed', texts?: string[]): Promise<T> {
  const reqId = reqSeq++
  return new Promise<T>((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject })
    worker.postMessage({ kind, reqId, texts })
  })
}

let warmed: Promise<void> | null = null
export function warmModel(): Promise<void> {
  warmed ??= call('warm').then(() => undefined)
  return warmed
}

// ---- cache ----

const cache = new Map<string, Float32Array>()

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

/** Text an embedding sees for a card: title + content for text; title/URL for media. */
export function embeddableText(card: Card): string {
  const title = card.title ? card.title + '. ' : ''
  if (card.type === 'text') return (title + card.content).slice(0, 512)
  if (card.type === 'link' || card.type === 'video') {
    return (title + card.content.replace(/^https?:\/\//, '').replace(/[/_-]+/g, ' ')).slice(0, 512)
  }
  // Images/sketches/files: embed whatever human-readable signal exists.
  return (title + (card.title ?? card.type)).slice(0, 512)
}

/**
 * Ensure every card has an embedding; returns a map id -> unit vector.
 * Batches only the cache misses.
 */
export async function embedCards(
  cards: Card[],
  onBatch?: (done: number, total: number) => void,
): Promise<Map<string, Float32Array>> {
  await warmModel()
  const result = new Map<string, Float32Array>()
  const missing: { card: Card; key: string; text: string }[] = []
  for (const card of cards) {
    const text = embeddableText(card)
    const key = hash(text)
    const hit = cache.get(key)
    if (hit) result.set(card.id, hit)
    else missing.push({ card, key, text })
  }
  const BATCH = 16
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH)
    const res = await call<{ dim: number; data: Float32Array }>(
      'embed',
      slice.map((m) => m.text),
    )
    const { dim, data } = res
    slice.forEach((m, j) => {
      const vec = new Float32Array(data.buffer, j * dim * 4, dim).slice()
      cache.set(m.key, vec)
      result.set(m.card.id, vec)
    })
    onBatch?.(Math.min(i + BATCH, missing.length), missing.length)
  }
  return result
}
