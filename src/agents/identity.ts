/** Visual identity per contributor — WHICH agent, not just "AI". */

export interface AgentMark {
  glyph: string
  color: string
  label: string
}

const KNOWN: Record<string, AgentMark> = {
  human: { glyph: '', color: 'var(--ink)', label: 'you' },
  claude: { glyph: '✳', color: '#c96442', label: 'Claude' },
  gemini: { glyph: '◆', color: '#3b7cf6', label: 'Gemini' },
  chatgpt: { glyph: '●', color: '#0faf94', label: 'ChatGPT' },
  grok: { glyph: '▲', color: '#8b8b94', label: 'Grok' },
  agent: { glyph: '✦', color: '#a06bd6', label: 'Agent' },
}

const PALETTE = ['#c96442', '#3b7cf6', '#0faf94', '#a06bd6', '#d4a017', '#d4547a']
const GLYPHS = ['✳', '◆', '●', '▲', '✦', '❖']

export function agentMark(name: string): AgentMark {
  const k = name.toLowerCase()
  if (KNOWN[k]) return KNOWN[k]
  for (const known of Object.keys(KNOWN)) {
    if (known !== 'human' && known !== 'agent' && k.includes(known)) return KNOWN[known]
  }
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  return {
    glyph: GLYPHS[h % GLYPHS.length],
    color: PALETTE[h % PALETTE.length],
    label: name,
  }
}
