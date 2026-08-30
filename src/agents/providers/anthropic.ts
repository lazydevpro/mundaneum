import type { ToolDef } from '../../mcp/registry'
import { apiKey, modelFor, proxyUrl } from '../config'
import type { Provider, ToolCall, TurnResult } from './types'

interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export const anthropic: Provider = {
  id: 'claude',

  userMessage: (text) => ({ role: 'user', content: text }),

  async send(messages, tools: ToolDef[], system): Promise<TurnResult> {
    const body = {
      model: modelFor('claude'),
      max_tokens: 4096,
      system,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    }

    const proxy = proxyUrl()
    const url = proxy ? proxy + '/anthropic' : 'https://api.anthropic.com/v1/messages'
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (!proxy) {
      const key = apiKey('claude')
      if (!key) throw new Error('No proxy configured and no Anthropic key set.')
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw new Error('Anthropic ' + res.status + ': ' + (await res.text()).slice(0, 300))
    const data = (await res.json()) as { content: ContentBlock[] }

    const text = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    const toolCalls: ToolCall[] = data.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }))

    return {
      text,
      toolCalls,
      assistantMessage: { role: 'assistant', content: data.content },
    }
  },

  toolResultMessages(calls, results) {
    return [
      {
        role: 'user',
        content: calls.map((c, i) => ({
          type: 'tool_result',
          tool_use_id: c.id,
          content: results[i],
        })),
      },
    ]
  },
}
