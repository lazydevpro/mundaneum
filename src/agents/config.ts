import { create } from 'zustand'

/**
 * Where in-page agents get their model access.
 *
 * Deployed on the Cloudflare Worker, app and proxy share one origin: keyless
 * routes (/unfurl, /drop, /health) always work, and model routes light up
 * per-provider once `wrangler secret put` has stored a key — the app probes
 * /health and offers exactly the agents this deployment can serve.
 *
 * Dev fallback: keys in localStorage, called direct from the browser where
 * the provider supports CORS. Never ship keys in the bundle.
 */

export type ProviderId = 'claude' | 'gemini' | 'grok'

const LS = {
  proxy: 'mundaneum:proxy',
  key: (p: ProviderId) => 'mundaneum:key:' + p,
  model: (p: ProviderId) => 'mundaneum:model:' + p,
}

interface Health {
  anthropic?: boolean
  gemini?: boolean
  xai?: boolean
}

const HEALTH_KEY: Record<ProviderId, keyof Health> = {
  claude: 'anthropic',
  gemini: 'gemini',
  grok: 'xai',
}

/** Set once /health confirms this origin's worker holds at least one key. */
export const useAgentAvail = create<{ health: Health | null }>(() => ({ health: null }))

function explicitProxy(): string | null {
  const env = import.meta.env.VITE_PROXY_URL as string | undefined
  const v = localStorage.getItem(LS.proxy) ?? env ?? ''
  return v ? v.replace(/\/$/, '') : null
}

/** Base for keyless worker routes: explicit proxy, or same-origin in prod. */
export function serviceBase(): string | null {
  return explicitProxy() ?? (import.meta.env.PROD ? '' : null)
}

/** Base for model routes: explicit proxy, or same-origin once /health says keys exist. */
export function proxyUrl(): string | null {
  const explicit = explicitProxy()
  if (explicit !== null) return explicit
  const h = useAgentAvail.getState().health
  if (import.meta.env.PROD && h && Object.values(h).some(Boolean)) return ''
  return null
}

/** Ask this deployment which agents it can serve. Fire-and-forget on load. */
export function probeProxy(): void {
  const base = serviceBase()
  if (base === null) return
  void fetch(base + '/health', { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
    .then((h) => {
      if (h) useAgentAvail.setState({ health: h })
    })
    .catch(() => {
      /* no worker behind this origin — in-page agents stay hidden */
    })
}

export function setProxyUrl(url: string): void {
  if (url) localStorage.setItem(LS.proxy, url)
  else localStorage.removeItem(LS.proxy)
  probeProxy()
}

export function apiKey(p: ProviderId): string | null {
  return localStorage.getItem(LS.key(p))
}

export function setApiKey(p: ProviderId, key: string): void {
  if (key) localStorage.setItem(LS.key(p), key)
  else localStorage.removeItem(LS.key(p))
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  claude: 'claude-sonnet-5',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-4',
}

export function modelFor(p: ProviderId): string {
  return localStorage.getItem(LS.model(p)) ?? DEFAULT_MODELS[p]
}

export function providerConfigured(p: ProviderId): boolean {
  if (apiKey(p)) return true
  if (explicitProxy()) return true
  const h = useAgentAvail.getState().health
  return Boolean(import.meta.env.PROD && h?.[HEALTH_KEY[p]])
}
