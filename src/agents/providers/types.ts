import type { ToolDef } from '../../mcp/registry'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  /** Provider-native assistant message to append to history verbatim. */
  assistantMessage: unknown
}

export interface Provider {
  id: 'claude' | 'gemini' | 'grok'
  send(messages: unknown[], tools: ToolDef[], system: string): Promise<TurnResult>
  userMessage(text: string): unknown
  toolResultMessages(calls: ToolCall[], results: string[]): unknown[]
}

/** Strip schema keywords some providers reject; keep the meaningful subset. */
export function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return { type: 'object' }
  const s = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['type', 'description', 'enum', 'required', 'format']) {
    if (k in s) out[k] = s[k]
  }
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitizeSchema(v),
      ]),
    )
  }
  if (s.items) out.items = sanitizeSchema(s.items)
  return out
}
