/**
 * Single source of truth for the tool surface. The same definitions are:
 *  - registered with the browser via document.modelContext (WebMCP), and
 *  - called directly by the in-page agent loop.
 *
 * THE RULE: no tool anywhere takes or returns a coordinate. All geometry
 * belongs to the page. If a coordinate ever shows up here, that is a bug.
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  untrustedContentHint?: boolean
}

export interface ToolDef {
  name: string
  /** Human-readable label per the WebMCP spec's optional title member. */
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
  /** Register only while this returns true (re-evaluated on board changes). */
  applicable?: () => boolean
  /** 'agent' tools are authored at runtime via register_tool. */
  source?: 'builtin' | 'agent'
  by?: string
  execute: (input: Record<string, unknown>, meta: { agent: string }) => string | Promise<string>
}

const listeners = new Set<() => void>()
export function onToolsChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify(): void {
  for (const cb of listeners) cb()
}

const tools = new Map<string, ToolDef>()

export function defineTool(def: ToolDef): void {
  tools.set(def.name, { source: 'builtin', ...def })
  notify()
}

export function removeTool(name: string): boolean {
  const ok = tools.delete(name)
  if (ok) notify()
  return ok
}

export function agentTools(): ToolDef[] {
  return allTools().filter((t) => t.source === 'agent')
}

export function allTools(): ToolDef[] {
  return [...tools.values()]
}

export function applicableTools(): ToolDef[] {
  return allTools().filter((t) => !t.applicable || t.applicable())
}

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name)
}

/** Normalize a self-reported agent name into a provenance signature. */
export function normalizeAgent(raw: unknown, fallback = 'agent'): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s || s === 'human') return fallback
  return s.replace(/[^a-z0-9 _.-]/g, '').slice(0, 24) || fallback
}

/** Execute by name — used by the in-page loop and the WebMCP bridge alike. */
export async function callTool(
  name: string,
  input: Record<string, unknown>,
  defaultAgent = 'agent',
): Promise<string> {
  const tool = tools.get(name)
  if (!tool) return JSON.stringify({ error: 'unknown tool: ' + name })
  if (tool.applicable && !tool.applicable()) {
    return JSON.stringify({ error: name + ' is not applicable right now' })
  }
  const agent = normalizeAgent((input as { agent?: unknown }).agent, defaultAgent)
  try {
    return await tool.execute(input ?? {}, { agent })
  } catch (err) {
    return JSON.stringify({ error: String(err) })
  }
}
