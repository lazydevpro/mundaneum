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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const headers = cors(env, req.headers.get('origin'))
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    try {
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
