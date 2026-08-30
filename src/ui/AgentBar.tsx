import { useRef, useState } from 'react'
import { agentMark } from '../agents/identity'
import { providerConfigured, type ProviderId } from '../agents/config'
import { runAgent } from '../agents/driver'
import { liveCards, useBoard } from '../store'

const PROVIDERS: ProviderId[] = ['claude', 'gemini', 'grok']

/**
 * One pill. Pick an agent, say a sentence, watch the board change.
 * The transcript is transient — the board itself is the output.
 */
export function AgentBar({ onNeedsSetup }: { onNeedsSetup: () => void }) {
  const [selected, setSelected] = useState<ProviderId>('claude')
  const [busy, setBusy] = useState<ProviderId | null>(null)
  const [say, setSay] = useState<{ agent: string; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sayTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hasCards = useBoard((s) => liveCards(s.cards).length > 0)

  // Zero-setup story stays visually pure: the in-page crew's pill appears
  // only once a proxy or key is configured (+ menu -> agents…). WebMCP
  // agents need none of this.
  if (!hasCards || !PROVIDERS.some(providerConfigured)) return null

  const submit = async () => {
    const text = inputRef.current?.value.trim()
    if (!text || busy) return
    if (!providerConfigured(selected)) {
      onNeedsSetup()
      return
    }
    inputRef.current!.value = ''
    setBusy(selected)
    const store = useBoard.getState()

    // If the ask mentions a video card, hand Gemini the actual URL to watch.
    const videoCard =
      selected === 'gemini' && /video|watch|transcri/i.test(text)
        ? liveCards(store.cards).find((c) => c.type === 'video' && /^https?:/.test(c.content))
        : undefined

    await runAgent(
      selected,
      text,
      (e) => {
        if (e.type === 'text' && e.text) {
          setSay({ agent: e.agent, text: e.text })
          clearTimeout(sayTimer.current)
          sayTimer.current = setTimeout(() => setSay(null), 14000)
        }
        if (e.type === 'tool') {
          useBoard.getState().logActivity(e.agent, 'called ' + e.tool)
        }
        if (e.type === 'error' && e.text) {
          setSay({ agent: e.agent, text: '⚠ ' + e.text.slice(0, 200) })
        }
      },
      videoCard ? { videoUrl: videoCard.content } : undefined,
    )
    setBusy(null)
  }

  return (
    <div className="chrome agent-bar">
      {say && (
        <div className="agent-say" onClick={() => setSay(null)}>
          <b style={{ color: agentMark(say.agent).color }}>{agentMark(say.agent).label}</b>{' '}
          {say.text}
        </div>
      )}
      <div className="agent-pill">
        {PROVIDERS.map((p) => {
          const mark = agentMark(p)
          const configured = providerConfigured(p)
          return (
            <button
              key={p}
              className={
                'agent-face' +
                (selected === p ? ' sel' : '') +
                (!configured ? ' dim' : '') +
                (busy === p ? ' busy' : '')
              }
              style={{ color: mark.color }}
              title={mark.label + (configured ? '' : ' — not configured (click, then set up)')}
              onClick={() => {
                setSelected(p)
                if (!configured) onNeedsSetup()
              }}
            >
              {mark.glyph}
            </button>
          )
        })}
        <input
          ref={inputRef}
          placeholder={busy ? agentMark(busy).label + ' is working…' : 'ask ' + agentMark(selected).label + '…'}
          disabled={Boolean(busy)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <button className="agent-send" onClick={() => void submit()} disabled={Boolean(busy)} aria-label="send">
          ↑
        </button>
      </div>
    </div>
  )
}
