import type { CardMeta, CardType } from '../types'

/**
 * The provider registry: one table mapping URLs to card types, faces, and
 * live embed URLs. Pure URL parsing — zero network — wherever possible; the
 * unfurl pipeline fills in the rest. This table is deliberately the single
 * seam where a future plugin system would attach: a plugin is just a row.
 */

export interface Classified {
  type: CardType
  meta: CardMeta
  /** true when noembed/worker unfurl should enrich title/thumbnail. */
  needsUnfurl: boolean
}

interface Provider {
  key: string
  site: string
  match: (u: URL) => boolean
  classify: (u: URL) => Partial<Classified> & { meta?: CardMeta }
}

const yt = (u: URL): string | null => {
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
    if (u.pathname.startsWith('/watch')) return u.searchParams.get('v')
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/)
    if (m) return m[2]
  }
  return null
}

const PROVIDERS: Provider[] = [
  {
    key: 'youtube',
    site: 'YouTube',
    match: (u) => yt(u) !== null,
    classify: (u) => {
      const id = yt(u)!
      return {
        type: 'video',
        meta: {
          image: 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg',
          // Real youtube.com, not -nocookie: the nocookie domain has no
          // session, so YouTube blocks playback with a bot check.
          embedUrl: 'https://www.youtube.com/embed/' + id,
        },
        needsUnfurl: true, // title via noembed
      }
    },
  },
  {
    key: 'vimeo',
    site: 'Vimeo',
    match: (u) => /(^|\.)vimeo\.com$/.test(u.hostname) && /\/\d+/.test(u.pathname),
    classify: (u) => {
      const id = u.pathname.match(/\/(\d+)/)![1]
      return {
        type: 'video',
        meta: { embedUrl: 'https://player.vimeo.com/video/' + id },
        needsUnfurl: true,
      }
    },
  },
  {
    key: 'loom',
    site: 'Loom',
    match: (u) => /(^|\.)loom\.com$/.test(u.hostname) && u.pathname.includes('/share/'),
    classify: (u) => ({
      type: 'video',
      meta: { embedUrl: 'https://www.loom.com/embed/' + u.pathname.split('/share/')[1] },
      needsUnfurl: true,
    }),
  },
  {
    key: 'spotify',
    site: 'Spotify',
    match: (u) =>
      /(^|\.)open\.spotify\.com$/.test(u.hostname) &&
      /^\/(track|album|playlist|episode|show|artist)\//.test(u.pathname),
    classify: (u) => ({
      type: 'audio',
      meta: { embedUrl: 'https://open.spotify.com/embed' + u.pathname.replace(/^\/intl-[a-z]+/, '') },
      needsUnfurl: true,
    }),
  },
  {
    key: 'applemusic',
    site: 'Apple Music',
    match: (u) => /(^|\.)music\.apple\.com$/.test(u.hostname),
    classify: (u) => ({
      type: 'audio',
      meta: { embedUrl: 'https://embed.music.apple.com' + u.pathname + u.search },
      needsUnfurl: true,
    }),
  },
  {
    key: 'soundcloud',
    site: 'SoundCloud',
    match: (u) => /(^|\.)soundcloud\.com$/.test(u.hostname) && u.pathname.length > 1,
    classify: (u) => ({
      type: 'audio',
      meta: {
        embedUrl:
          'https://w.soundcloud.com/player/?visual=true&url=' + encodeURIComponent(u.href),
      },
      needsUnfurl: true,
    }),
  },
  {
    key: 'instagram',
    site: 'Instagram',
    match: (u) =>
      /(^|\.)instagram\.com$/.test(u.hostname) && /^\/(p|reel|reels)\//.test(u.pathname),
    classify: (u) => {
      const m = u.pathname.match(/^\/(p|reel|reels)\/([\w-]+)/)!
      return {
        type: 'social',
        meta: { embedUrl: 'https://www.instagram.com/p/' + m[2] + '/embed/' },
        needsUnfurl: true,
      }
    },
  },
  {
    key: 'tiktok',
    site: 'TikTok',
    match: (u) => /(^|\.)tiktok\.com$/.test(u.hostname) && u.pathname.includes('/video/'),
    classify: (u) => ({
      type: 'social',
      meta: {
        embedUrl: 'https://www.tiktok.com/embed/v2/' + u.pathname.split('/video/')[1].split('/')[0],
      },
      needsUnfurl: true,
    }),
  },
  {
    key: 'x',
    site: 'X',
    match: (u) =>
      /(^|\.)(twitter|x)\.com$/.test(u.hostname) && /\/status\/\d+/.test(u.pathname),
    // X blocks framing; the face becomes a quote card via unfurl, live opens the post.
    classify: () => ({ type: 'social', needsUnfurl: true }),
  },
  {
    key: 'figma',
    site: 'Figma',
    match: (u) => /(^|\.)figma\.com$/.test(u.hostname) && /\/(file|design|proto|board)\//.test(u.pathname),
    classify: (u) => ({
      type: 'link',
      meta: {
        embedUrl: 'https://www.figma.com/embed?embed_host=mundaneum&url=' + encodeURIComponent(u.href),
      },
      needsUnfurl: true,
    }),
  },
  {
    key: 'maps',
    site: 'Google Maps',
    match: (u) => /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/maps'),
    classify: (u) => ({
      type: 'link',
      meta: { embedUrl: 'https://maps.google.com/maps?output=embed&q=' + encodeURIComponent(u.pathname.split('/place/')[1]?.split('/')[0]?.replace(/\+/g, ' ') ?? u.href) },
      needsUnfurl: false,
    }),
  },
]

/** Agent-registered providers (add_provider) — checked before the built-ins,
 *  so a live session can teach the board new platforms (Pinterest, Twitch…). */
export interface RuntimeProvider {
  key: string
  site: string
  hostContains: string
  pathIncludes?: string
  type: CardType
  embedTemplate?: string // {url} = encoded href, {href} = raw href, {path1} = first path segment
  needsUnfurl?: boolean
  /** When it was taught, so sync can tell a re-add from a stale copy. */
  at?: number
}

let runtime: RuntimeProvider[] = []
export function runtimeProviders(): RuntimeProvider[] {
  return runtime.slice()
}
export function setRuntimeProviders(list: RuntimeProvider[]): void {
  runtime = list.slice()
}
export function addRuntimeProvider(p: RuntimeProvider): void {
  runtime = [p, ...runtime.filter((x) => x.key !== p.key)]
}
export function removeRuntimeProvider(key: string): void {
  runtime = runtime.filter((x) => x.key !== key)
}

function fillTemplate(tpl: string, u: URL): string {
  return tpl
    .replace(/\{url\}/g, encodeURIComponent(u.href))
    .replace(/\{href\}/g, u.href)
    .replace(/\{path1\}/g, u.pathname.split('/').filter(Boolean)[0] ?? '')
    .replace(/\{pathLast\}/g, u.pathname.split('/').filter(Boolean).pop() ?? '')
}

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)(\?|$)/i
const AUDIO_FILE = /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i
const MODEL_FILE = /\.(glb|gltf)(\?|$)/i

export function classifyUrl(raw: string): Classified {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { type: 'link', meta: {}, needsUnfurl: false }
  }

  for (const rp of runtime) {
    if (u.hostname.includes(rp.hostContains) && (!rp.pathIncludes || u.pathname.includes(rp.pathIncludes))) {
      return {
        type: rp.type,
        meta: {
          provider: rp.key,
          site: rp.site,
          ...(rp.embedTemplate ? { embedUrl: fillTemplate(rp.embedTemplate, u) } : {}),
        },
        needsUnfurl: rp.needsUnfurl ?? !rp.embedTemplate,
      }
    }
  }

  for (const p of PROVIDERS) {
    if (p.match(u)) {
      const c = p.classify(u)
      return {
        type: c.type ?? 'link',
        meta: { ...c.meta, provider: p.key, site: p.site },
        needsUnfurl: c.needsUnfurl ?? true,
      }
    }
  }

  // Direct media URLs embed natively — no provider needed.
  if (VIDEO_FILE.test(u.pathname)) {
    return { type: 'video', meta: { provider: 'file-url', embedUrl: raw }, needsUnfurl: false }
  }
  if (AUDIO_FILE.test(u.pathname)) {
    return { type: 'audio', meta: { provider: 'file-url', embedUrl: raw }, needsUnfurl: false }
  }
  if (IMAGE_FILE.test(u.pathname)) {
    return { type: 'image', meta: { provider: 'file-url' }, needsUnfurl: false }
  }
  if (MODEL_FILE.test(u.pathname)) {
    return { type: 'model', meta: { provider: 'file-url', embedUrl: raw }, needsUnfurl: false }
  }

  // Everything else: an article/page → social-preview face via unfurl.
  return {
    type: 'link',
    meta: { provider: 'article', site: u.hostname.replace(/^www\./, '') },
    needsUnfurl: true,
  }
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw.slice(0, 40)
  }
}
