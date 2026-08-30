/**
 * Where in-page agents get their model access.
 *
 * Preferred: a Cloudflare Worker proxy (worker/) holding keys server-side —
 * routes /anthropic, /gemini, /xai. Tool execution never leaves the browser;
 * only the conversation + tool results go to the model API.
 *
 * Dev fallback: keys in localStorage, called direct from the browser where
 * the provider supports CORS (Anthropic with the dangerous-direct header,
 * Gemini natively). Never ship keys in the bundle.
 */

export type ProviderId = 'claude' | 'gemini' | 'grok'

const LS = {
  proxy: 'mundaneum:proxy',
  key: (p: ProviderId) => 'mundaneum:key:' + p,
  model: (p: ProviderId) => 'mundaneum:model:' + p,
}

export function proxyUrl(): string | null {
  const env = import.meta.env.VITE_PROXY_URL as string | undefined
  const v = localStorage.getItem(LS.proxy) ?? env ?? ''
  return v ? v.replace(/\/$/, '') : null
}

export function setProxyUrl(url: string): void {
  if (url) localStorage.setItem(LS.proxy, url)
  else localStorage.removeItem(LS.proxy)
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
  return Boolean(proxyUrl() || apiKey(p))
}
