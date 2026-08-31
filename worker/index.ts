/**
 * Mundaneum proxy — Cloudflare Worker.
 *
 * Holds provider keys server-side for the in-page agents:
 *   POST /anthropic  -> api.anthropic.com/v1/messages
 *   POST /gemini     -> generativelanguage.googleapis.com (:generateContent)
 *   POST /xai        -> api.x.ai/v1/chat/completions
 *
 * Plus the phone mail slot (not a sync backend — an ephemeral drop):
 *   POST /drop/:board  { image: dataUrl }   (kept ~10 min)
 *   GET  /drop/:board  -> { images: [...] } (clears on read)
 *
 * The slot lives in a Durable Object, one per board. Worker isolates do not
 * share memory — an in-process Map silently dropped every photo, because the
 * phone's POST and the desktop's GET land on different isolates.
 *
 * Secrets: wrangler secret put ANTHROPIC_API_KEY / GEMINI_API_KEY / XAI_API_KEY
 * Optional var ALLOWED_ORIGIN locks CORS to the deployed app origin.
 */

// The merge rule is shared with the client rather than reimplemented here,
// so the two can't drift apart (the module is types + pure functions only).
import { mergeDocs, type SyncDoc } from '../src/sync/doc'
import { handleMcpRequest } from './mcp'

export interface Env {
  ANTHROPIC_API_KEY?: string
  GEMINI_API_KEY?: string
  XAI_API_KEY?: string
  ALLOWED_ORIGIN?: string
  ROOMS?: DurableObjectNamespace
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): { fetch(req: Request): Promise<Response> }
}
type DurableObjectId = { toString(): string }

interface DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
  }
}

const DROP_TTL_MS = 10 * 60 * 1000

/**
 * Cost is bounded by construction, not by trust:
 *  - a board's shared document is capped, so no board can grow without limit
 *  - writes are rate limited per room
 *  - a room untouched for IDLE_DAYS deletes itself on next contact
 *  - binary assets (video, 3D, documents) never reach the server at all —
 *    only the document and its small compressed images travel
 * Free-tier Durable Objects hold this comfortably; storage can't creep.
 */
const MAX_DOC_BYTES = 4_000_000
const MAX_WRITES_PER_MIN = 40
const IDLE_DAYS = 45

/** One board: an ephemeral photo slot plus the shared document. */
export class BoardRoom {
  private state: DurableObjectState
  constructor(state: DurableObjectState) {
    this.state = state
  }

  private async rateLimited(): Promise<boolean> {
    const now = Date.now()
    const w = (await this.state.storage.get<{ n: number; at: number }>('rate')) ?? { n: 0, at: now }
    const fresh = now - w.at > 60_000 ? { n: 0, at: now } : w
    if (fresh.n >= MAX_WRITES_PER_MIN) return true
    await this.state.storage.put('rate', { n: fresh.n + 1, at: fresh.at })
    return false
  }

  async fetch(req: Request): Promise<Response> {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    // MCP runs inside the DO: single-threaded, so a tool call is an atomic
    // read-modify-write on this board's document.
    if (new URL(req.url).pathname.startsWith('/mcp')) {
      if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
      const batch = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
      const doc = await this.state.storage.get<SyncDoc>('doc')
      if (!doc) {
        /**
         * The transport succeeded; the failure is a JSON-RPC one, so it goes
         * in the body with a 200. Answering 404 makes clients report a
         * connection error and swallow the very message that says how to fix
         * it. Each reply carries its own request's id — the spec only allows
         * a null id when the id couldn't be read at all.
         */
        const refusals = batch
          .filter((one) => one?.id !== undefined)
          .map((one) => ({
            jsonrpc: '2.0',
            id: one.id,
            error: {
              code: -32001,
              message:
                'That board has not been shared yet. Open it in a browser and press Share, then connect to this URL again.',
            },
          }))
        if (!refusals.length) return new Response(null, { status: 202 })
        return json(Array.isArray(body) ? refusals : refusals[0])
      }
      const replies: unknown[] = []
      let dirty = false
      for (const one of batch) {
        const { response, changed } = handleMcpRequest(one, doc)
        if (changed) dirty = true
        if (response) replies.push(response)
      }
      if (dirty) {
        doc.updatedAt = Date.now()
        await this.state.storage.put('doc', doc)
        await this.state.storage.put('seen', Date.now())
      }
      // A batch of only notifications gets 202 with no body, per JSON-RPC.
      if (!replies.length) return new Response(null, { status: 202 })
      return json(Array.isArray(body) ? replies : replies[0])
    }

    if (new URL(req.url).pathname.startsWith('/room/')) {
      const seen = await this.state.storage.get<number>('seen')
      if (seen && Date.now() - seen > IDLE_DAYS * 86_400_000) {
        await this.state.storage.delete('doc')
      }
      if (req.method === 'GET') {
        const doc = await this.state.storage.get<unknown>('doc')
        return doc ? json(doc) : json({ error: 'no shared board yet' }, 404)
      }
      if (req.method !== 'POST') return json({ error: 'method' }, 405)
      if (await this.rateLimited()) return json({ error: 'too many writes, slow down' }, 429)

      const text = await req.text()
      if (text.length > MAX_DOC_BYTES) {
        return json({ error: 'board exceeds the ' + Math.round(MAX_DOC_BYTES / 1e6) + ' MB share limit' }, 413)
      }
      const incoming = JSON.parse(text) as SyncDoc
      const existing = await this.state.storage.get<SyncDoc>('doc')
      const merged = existing ? mergeDocs(existing, incoming) : incoming
      await this.state.storage.put('doc', merged)
      await this.state.storage.put('seen', Date.now())
      return json(merged)
    }

    if (req.method === 'POST') {
      const body = (await req.json()) as { image?: string }
      if (!body.image || typeof body.image !== 'string' || body.image.length > 2_500_000) {
        return json({ error: 'image missing or too large' }, 400)
      }
      const slot = (await this.state.storage.get<{ images: string[]; at: number }>('drop')) ?? {
        images: [],
        at: Date.now(),
      }
      const fresh = Date.now() - slot.at < DROP_TTL_MS ? slot.images : []
      await this.state.storage.put('drop', {
        images: [...fresh, body.image].slice(-6),
        at: Date.now(),
      })
      return json({ ok: true })
    }

    const slot = await this.state.storage.get<{ images: string[]; at: number }>('drop')
    const images = slot && Date.now() - slot.at < DROP_TTL_MS ? slot.images : []
    if (slot) await this.state.storage.delete('drop')
    return json({ images })
  }
}

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

      // Re-host an image (agent-generated URLs expire): fetch server-side,
      // pass bytes back with CORS so the page can intern it as a data URL.
      if (url.pathname === '/img' && req.method === 'GET') {
        const target = url.searchParams.get('url') ?? ''
        if (!/^https?:\/\//.test(target)) return json({ error: 'bad url' }, 400, headers)
        const upstream = await fetch(target, {
          redirect: 'follow',
          signal: AbortSignal.timeout(12000),
        })
        const ctype = upstream.headers.get('content-type') ?? ''
        if (!upstream.ok || !ctype.startsWith('image/')) {
          return json({ error: 'not an image (' + upstream.status + ')' }, 415, headers)
        }
        const len = Number(upstream.headers.get('content-length') ?? 0)
        if (len > 12_000_000) return json({ error: 'image too large' }, 413, headers)
        return new Response(upstream.body, {
          status: 200,
          headers: { 'content-type': ctype, 'cache-control': 'public, max-age=86400', ...headers },
        })
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

      // Classic MCP endpoint: /mcp/:board — point any MCP client here.
      const mcp = url.pathname.match(/^\/mcp\/([a-z0-9-]{1,40})$/i)
      if (mcp) {
        if (!env.ROOMS) return json({ error: 'sharing not configured' }, 501, headers)
        const mcpHeaders = {
          ...headers,
          'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, authorization',
          'access-control-expose-headers': 'mcp-session-id',
        }
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: mcpHeaders })
        // No SSE stream is offered; clients fall back to plain POST.
        if (req.method === 'GET') return json({ error: 'this endpoint is POST-only' }, 405, mcpHeaders)
        const obj = env.ROOMS.get(env.ROOMS.idFromName('board:' + mcp[1]))
        const res = await obj.fetch(
          new Request('https://do/mcp', { method: 'POST', body: req.body }),
        )
        return new Response(res.body, {
          status: res.status,
          headers: { 'content-type': 'application/json', ...mcpHeaders },
        })
      }

      // Shared board document, one Durable Object per board.
      const room = url.pathname.match(/^\/room\/([a-z0-9-]{1,40})$/i)
      if (room && (req.method === 'POST' || req.method === 'GET')) {
        if (!env.ROOMS) return json({ error: 'sharing not configured' }, 501, headers)
        const obj = env.ROOMS.get(env.ROOMS.idFromName('board:' + room[1]))
        const res = await obj.fetch(new Request(req.url, { method: req.method, body: req.body }))
        return new Response(res.body, {
          status: res.status,
          headers: { 'content-type': 'application/json', ...headers },
        })
      }

      const drop = url.pathname.match(/^\/drop\/([a-z0-9-]{1,40})$/i)
      if (drop && (req.method === 'POST' || req.method === 'GET')) {
        if (!env.ROOMS) return json({ error: 'drop slot not configured' }, 501, headers)
        const room = env.ROOMS.get(env.ROOMS.idFromName('drop:' + drop[1]))
        const res = await room.fetch(new Request(req.url, { method: req.method, body: req.body }))
        return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', ...headers } })
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
