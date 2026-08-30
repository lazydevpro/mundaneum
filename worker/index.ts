/**
 * Mundaneum proxy — Cloudflare Worker.
 *
 * Holds provider keys server-side for the in-page agents:
 *   POST /anthropic  -> api.anthropic.com/v1/messages
 *   POST /gemini     -> generativelanguage.googleapis.com (:generateContent)
 *   POST /xai        -> api.x.ai/v1/chat/completions
 *
 * Plus the phone mail slot (not a sync backend — an ephemeral drop):
 *   POST /drop/:board  { image: dataUrl }   (kept ~5 min)
 *   GET  /drop/:board  -> { images: [...] } (clears on read)
 *
 * Secrets: wrangler secret put ANTHROPIC_API_KEY / GEMINI_API_KEY / XAI_API_KEY
 * Optional var ALLOWED_ORIGIN locks CORS to the deployed app origin.
 */

export interface Env {
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  XAI_API_KEY?: string
  ALLOWED_ORIGIN?: string
  DROPS?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

const memoryDrops = new Map<string, { images: string[]; at: number }>()

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN
  return {
    'access-control-allow-origin': allowed ?? origin ?? '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    ...(allowed ? { vary: 'origin' } : {}),
  }
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url)
    const headers = cors(env, req.headers.get('origin'))
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    try {
      // Model files proxied through this origin: ad/privacy blockers that
      // kill cross-origin fetches to huggingface.co can't touch same-origin
      // requests, and the edge cache spares HF repeat downloads.
      if (url.pathname.startsWith('/hf/') && req.method === 'GET') {
        const target = 'https://huggingface.co/' + url.pathname.slice(4) + url.search
        const cache = (caches as unknown as { default: Cache }).default
        const cacheKey = new Request(target)
        const hit = await cache.match(cacheKey)
        if (hit) return hit
        const upstream = await fetch(target, { redirect: 'follow' })
        if (!upstream.ok) {
          return json({ error: 'upstream ' + upstream.status }, upstream.status, headers)
        }
        const res = new Response(upstream.body, {
          status: 200,
          headers: {
            'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
            'cache-control': 'public, max-age=31536000, immutable',
            ...headers,
          },
        })
        ctx.waitUntil(cache.put(cacheKey, res.clone()))
        return res
      }

      if (url.pathname === '/health' && req.method === 'GET') {
        // Which in-page agents this deployment can serve; never the keys.
        return json(
          {
            anthropic: Boolean(env.ANTHROPIC_API_KEY),
            gemini: Boolean(env.GEMINI_API_KEY),
            xai: Boolean(env.XAI_API_KEY),
          },
          200,
          headers,
        )
      }

      if (url.pathname === '/anthropic' && req.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 501, headers)
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: await req.text(),
        })
        return new Response(upstream.body, { status: upstream.status, headers })
      }

      if (url.pathname === '/gemini' && req.method === 'POST') {
        if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 501, headers)
        const model = url.searchParams.get('model') ?? 'gemini-2.5-flash'
        const upstream = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent?key=' +
            env.GEMINI_API_KEY,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: await req.text(),
          },
        )
        return new Response(upstream.body, { status: upstream.status, headers })
      }

      if (url.pathname === '/xai' && req.method === 'POST') {
        if (!env.XAI_API_KEY) return json({ error: 'XAI_API_KEY not set' }, 501, headers)
        const upstream = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + env.XAI_API_KEY,
          },
          body: await req.text(),
        })
        return new Response(upstream.body, { status: upstream.status, headers })
      }

      if (url.pathname === '/unfurl' && req.method === 'GET') {
        const target = url.searchParams.get('url') ?? ''
        if (!/^https?:\/\//.test(target)) return json({ error: 'bad url' }, 400, headers)
        const meta = await unfurl(target)
        return json(meta, 200, { ...headers, 'cache-control': 'public, max-age=86400' })
      }

      const drop = url.pathname.match(/^\/drop\/([a-z0-9-]{1,40})$/i)
      if (drop) {
        const boardKey = 'drop:' + drop[1]
        if (req.method === 'POST') {
          const body = (await req.json()) as { image?: string }
          if (!body.image || typeof body.image !== 'string' || body.image.length > 2_500_000) {
            return json({ error: 'image missing or too large' }, 400, headers)
          }
          if (env.DROPS) {
            const existing = JSON.parse((await env.DROPS.get(boardKey)) ?? '[]') as string[]
            existing.push(body.image)
            await env.DROPS.put(boardKey, JSON.stringify(existing.slice(-6)), {
              expirationTtl: 300,
            })
          } else {
            const slot = memoryDrops.get(boardKey) ?? { images: [], at: Date.now() }
            slot.images = [...slot.images, body.image].slice(-6)
            slot.at = Date.now()
            memoryDrops.set(boardKey, slot)
          }
          return json({ ok: true }, 200, headers)
        }
        if (req.method === 'GET') {
          let images: string[] = []
          if (env.DROPS) {
            images = JSON.parse((await env.DROPS.get(boardKey)) ?? '[]') as string[]
            if (images.length) await env.DROPS.delete(boardKey)
          } else {
            const slot = memoryDrops.get(boardKey)
            if (slot && Date.now() - slot.at < 300_000) images = slot.images
            memoryDrops.delete(boardKey)
          }
          return json({ images }, 200, headers)
        }
      }

      return json({ error: 'not found' }, 404, headers)
    } catch (err) {
      return json({ error: String(err) }, 500, headers)
    }
  },
}

/**
 * Server-side og:/twitter: tag extraction — the piece the browser cannot do
 * cross-origin. HTMLRewriter streams the page; we stop caring after <head>.
 */
async function unfurl(target: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let res: Response
  try {
    res = await fetch(target, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MundaneumUnfurl/1.0; +https://github.com)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return out
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return out

  let title = ''
  const grab = (k: keyof typeof out & string) => ({
    element(el: { getAttribute(n: string): string | null }) {
      const v = el.getAttribute('content')
      if (v && !out[k]) out[k] = v.slice(0, 500)
    },
  })

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:title"]', grab('title'))
    .on('meta[name="twitter:title"]', grab('title'))
    .on('meta[property="og:description"]', grab('description'))
    .on('meta[name="description"]', grab('description'))
    .on('meta[name="twitter:description"]', grab('description'))
    .on('meta[property="og:image"]', grab('image'))
    .on('meta[name="twitter:image"]', grab('image'))
    .on('meta[property="og:site_name"]', grab('site'))
    .on('title', {
      text(t: { text: string }) {
        if (title.length < 300) title += t.text
      },
    })

  // Read at most ~200KB of the page through the rewriter.
  const transformed = rewriter.transform(res)
  const reader = transformed.body?.getReader()
  if (reader) {
    let got = 0
    while (got < 200_000) {
      const { done, value } = await reader.read()
      if (done) break
      got += value?.length ?? 0
    }
    await reader.cancel().catch(() => undefined)
  }

  if (!out.title && title.trim()) out.title = title.trim().slice(0, 300)
  for (const k of Object.keys(out)) {
    out[k] = out[k]
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  if (out.image && out.image.startsWith('/')) {
    try {
      out.image = new URL(out.image, target).href
    } catch {
      delete out.image
    }
  }
  return out
}

declare class HTMLRewriter {
  on(selector: string, handlers: Record<string, unknown>): HTMLRewriter
  transform(res: Response): Response
}
