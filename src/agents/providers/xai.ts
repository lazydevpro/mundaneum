import type { ToolDef } from '../../mcp/registry'
import { apiKey, modelFor, proxyUrl } from '../config'
import type { Provider, ToolCall, TurnResult } from './types'

interface OaiToolCall {
  id: string
  function: { name: string; arguments: string }
}

/** Grok over the OpenAI-compatible surface. Live-social angle: xAI owns X. */
export const xai: Provider = {
  id: 'grok',

  userMessage: (text) => ({ role: 'user', content: text }),

  async send(messages, tools: ToolDef[], system): Promise<TurnResult> {
    const body = {
      model: modelFor('grok'),
      messages: [{ role: 'system', content: system }, ...messages],
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    }

    const proxy = proxyUrl()
    const url = proxy ? proxy + '/xai' : 'https://api.x.ai/v1/chat/completions'
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (!proxy) {
      const key = apiKey('grok')
      if (!key) throw new Error('No proxy configured and no xAI key set.')
      headers.authorization = 'Bearer ' + key
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw new Error('xAI ' + res.status + ': ' + (await res.text()).slice(0, 300))
    const data = (await res.json()) as {
      choices: Array<{
        message: { content?: string | null; tool_calls?: OaiToolCall[] }
      }>
    }

    const msg = data.choices[0]?.message ?? {}
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      input: safeParse(c.function.arguments),
    }))

    return {
      text: msg.content ?? '',
      toolCalls,
      assistantMessage: { role: 'assistant', ...msg },
    }
  },

  toolResultMessages(calls, results) {
    return calls.map((c, i) => ({
      role: 'tool',
      tool_call_id: c.id,
      content: results[i],
    }))
  },
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}
