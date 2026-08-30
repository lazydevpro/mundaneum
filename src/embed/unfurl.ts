import { useBoard } from '../store'
import { proxyUrl } from '../agents/config'
import { hostOf } from './providers'
import type { CardMeta } from '../types'

/**
 * Progressive enrichment: the card renders instantly with whatever the URL
 * alone gives (thumbnail, site); title/description/image arrive async and
 * patch in. Ladder: noembed.com (CORS-friendly oEmbed aggregator) → the
 * worker's /unfurl (og: tags, server-side) → give up gracefully (domain face).
 */

const inflight = new Set<string>()

export function enrichCard(cardId: string): void {
  const card = useBoard.getState().cards[cardId]
  if (!card || card.meta?.unfurled || inflight.has(cardId)) return
  if (!/^https?:\/\//.test(card.content)) return
  inflight.add(cardId)
  void enrich(cardId, card.content).finally(() => inflight.delete(cardId))
}

/** Provider-native oEmbed endpoints that serve CORS to browsers. */
const NATIVE_OEMBED: Array<{ test: RegExp; endpoint: (u: string) => string }> = [
  { test: /open\.spotify\.com/, endpoint: (u) => 'https://open.spotify.com/oembed?url=' + encodeURIComponent(u) },
  { test: /vimeo\.com/, endpoint: (u) => 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(u) },
  { test: /tiktok\.com/, endpoint: (u) => 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(u) },
]

async function enrich(cardId: string, url: string): Promise<void> {
  const patch: CardMeta = {}

  const native = NATIVE_OEMBED.find((n) => n.test.test(url))
  if (native) {
    const d = await tryOembedEndpoint(native.endpoint(url))
    if (d) Object.assign(patch, d)
  }
  if (!patch.title) {
    const oembed = await tryNoembed(url)
    if (oembed) Object.assign(patch, { ...oembed, ...patch })
  }

  if (!patch.title || !patch.description) {
    const og = await tryWorkerUnfurl(url)
    if (og) {
      for (const [k, v] of Object.entries(og)) {
        if (v && !(patch as Record<string, unknown>)[k]) {
          ;(patch as Record<string, unknown>)[k] = v
        }
      }
    }
  }

  const store = useBoard.getState()
  const card = store.cards[cardId]
  if (!card) return
  store.updateCard(cardId, {
    meta: { ...card.meta, ...patch, unfurled: true },
    // Title feeds clustering + agent excerpts; never overwrite a human title.
    title: card.title ?? patch.title?.slice(0, 140),
  })
}

async function tryOembedEndpoint(endpoint: string): Promise<CardMeta | null> {
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const d = (await res.json()) as {
      title?: string
      thumbnail_url?: string
      provider_name?: string
      author_name?: string
    }
    const meta: CardMeta = {}
    if (d.title) meta.title = d.title
    if (d.thumbnail_url) meta.image = d.thumbnail_url
    if (d.author_name && d.title) meta.description = d.author_name
    return Object.keys(meta).length ? meta : null
  } catch {
    return null
  }
}

async function tryNoembed(url: string): Promise<CardMeta | null> {
  try {
    const res = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url), {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = (await res.json()) as {
      title?: string
      thumbnail_url?: string
      provider_name?: string
      author_name?: string
      html?: string
      error?: string
    }
    if (d.error) return null
    const meta: CardMeta = {}
    if (d.title) meta.title = d.title
    if (d.thumbnail_url) meta.image = d.thumbnail_url
    if (d.provider_name) meta.site = d.provider_name
    // X/Twitter: oEmbed html carries the post text — extract for a quote face.
    if (d.html && /twitter|x\.com/i.test(d.provider_name ?? '')) {
      const text = new DOMParser()
        .parseFromString(d.html, 'text/html')
        .body.textContent?.trim()
      if (text) meta.description = text.slice(0, 400)
      if (d.author_name) meta.site = d.author_name + ' on X'
    }
    return Object.keys(meta).length ? meta : null
  } catch {
    return null
  }
}

async function tryWorkerUnfurl(url: string): Promise<CardMeta | null> {
  const proxy = proxyUrl()
  if (!proxy) return null
  try {
    const res = await fetch(proxy + '/unfurl?url=' + encodeURIComponent(url), {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return (await res.json()) as CardMeta
  } catch {
    return null
  }
}

export { hostOf }
