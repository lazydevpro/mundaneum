import type { ToolDef } from '../../mcp/registry'
import { apiKey, modelFor, proxyUrl } from '../config'
import { sanitizeSchema, type Provider, type ToolCall, type TurnResult } from './types'

interface Part {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  fileData?: { fileUri: string }
}

/**
 * Gemini is the video-capable agent: the only major model with native video
 * and YouTube URL input, which is why "transcribe this video" handoffs route
 * here. Video cards' URLs are attached as fileData parts.
 */
export const gemini: Provider = {
  id: 'gemini',

  userMessage: (text) => ({ role: 'user', parts: [{ text }] }),

  async send(messages, tools: ToolDef[], system): Promise<TurnResult> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchema(t.inputSchema),
          })),
        },
      ],
    }

    const proxy = proxyUrl()
    const model = modelFor('gemini')
    let url: string
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (proxy) {
      url = proxy + '/gemini?model=' + encodeURIComponent(model)
    } else {
      const key = apiKey('gemini')
      if (!key) throw new Error('No proxy configured and no Gemini key set.')
      url =
        'https://generativelanguage.googleapis.com/v1beta/models/' +
        model +
        ':generateContent?key=' +
        key
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) throw new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0, 300))
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Part[] } }>
    }

    const parts = data.candidates?.[0]?.content?.parts ?? []
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n')
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: 'g' + i,
        name: p.functionCall!.name,
        input: p.functionCall!.args ?? {},
      }))

    return {
      text,
      toolCalls,
      assistantMessage: { role: 'model', parts: parts.length ? parts : [{ text: '' }] },
    }
  },

  toolResultMessages(calls, results) {
    return [
      {
        role: 'user',
        parts: calls.map((c, i) => ({
          functionResponse: {
            name: c.name,
            response: { result: results[i] },
          },
        })),
      },
    ]
  },
}

/** Attach a video URL so Gemini can actually watch it. */
export function geminiVideoMessage(text: string, videoUrl: string): unknown {
  return { role: 'user', parts: [{ text }, { fileData: { fileUri: videoUrl } }] }
}
