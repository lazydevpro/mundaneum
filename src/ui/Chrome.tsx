import { useEffect, useMemo, useRef, useState } from 'react'
import { liveCards, useBoard } from '../store'
import { agentMark } from '../agents/identity'
import type { WebMcpStatus } from '../mcp/webmcp'
import { applyArrangement } from '../engine/engine'
import type { Arrangement, CardStyle } from '../types'
import { Icon } from './icons'

/** Everything that is not the board, kept to a whisper. */

export function Brand() {
  const name = useBoard((s) => s.boardName)
  return (
    <div className="chrome brand">
      <span className="word">Mundaneum</span>
      <input
        value={name}
        onChange={(e) => useBoard.getState().renameBoard(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-label="board name"
      />
    </div>
  )
}

export function StatusLine({ webmcp }: { webmcp: WebMcpStatus }) {
  const status = useBoard((s) => s.engineStatus)
  const detail = useBoard((s) => s.engineDetail)
  const activity = useBoard((s) => s.activity[0])
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!activity) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 5000)
    return () => clearTimeout(t)
  }, [activity])

  const engineText =
    status === 'warming'
      ? 'warming the engine · ' + detail
      : status === 'embedding'
        ? 'reading cards · ' + detail
        : status === 'organizing'
          ? 'computing structure…'
          : status === 'cold' && detail
            ? detail
            : ''

  return (
    <div className="chrome status-line">
      <span
        className={'live-dot' + (webmcp === 'live' ? ' on' : '')}
        title={
          webmcp === 'live'
            ? 'WebMCP live — agents in this browser can see this board'
            : 'WebMCP unavailable — enable chrome://flags/#enable-webmcp-testing or serve with an origin-trial token'
        }
      />
      {engineText && <span>{engineText}</span>}
      {flash && activity && (
        <span>
          <b style={{ color: agentMark(activity.agent).color }}>{agentMark(activity.agent).label}</b>{' '}
          {activity.text}
        </span>
      )}
    </div>
  )
}

const ARRANGEMENTS: Array<[Arrangement, string]> = [
  ['clusters', 'clusters'],
  ['masonry', 'masonry'],
  ['grid', 'grid'],
  ['row', 'one row'],
  ['column', 'one column'],
  ['tree', 'tree — from the links'],
]

export function CornerControls() {
  const filters = useBoard((s) => s.filters)
  const prefs = useBoard((s) => s.prefs)
  const cardsMap = useBoard((s) => s.cards)
  const cards = useMemo(() => liveCards(cardsMap), [cardsMap])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const pending = cards.filter((c) => !c.accepted).length
  const agents = [...new Set(cards.map((c) => c.addedBy))].filter((a) => a !== 'human')
  const active = filters.mode !== 'all' || filters.hiddenAgents.length > 0

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  if (cards.length === 0) return null

  return (
    <div className="chrome corner-tr" ref={ref}>
      {pending > 0 && (
        <button
          className={'chip' + (filters.mode === 'pending' ? ' active' : '')}
          onClick={() =>
            useBoard.getState().setFilters({ mode: filters.mode === 'pending' ? 'all' : 'pending' })
          }
          title="cards from agents awaiting your review"
        >
          <span className="count">{pending}</span> to review
        </button>
      )}
      <div style={{ position: 'relative' }}>
        <button className={'chip' + (active ? ' active' : '')} onClick={() => setOpen(!open)}>
          <Icon name="half" size={13} />
        </button>
        {open && (
          <div className="popover">
            <div className="head">style</div>
            {(
              [
                ['pure', 'pure — just the material'],
                ['cards', 'cards — framed'],
              ] as Array<[CardStyle, string]>
            ).map(([st, label]) => (
              <button
                key={st}
                className={'row' + (prefs.style === st ? ' on' : '')}
                onClick={() => useBoard.getState().setPrefs({ style: st })}
              >
                {label}
              </button>
            ))}
            <div className="sep" />
            <div className="head">arrange</div>
            {ARRANGEMENTS.map(([mode, label]) => (
              <button
                key={mode}
                className={'row' + (prefs.arrangement === mode ? ' on' : '')}
                onClick={() => applyArrangement(mode)}
              >
                {label}
              </button>
            ))}
            <div className="sep" />
            <div className="head">toolbar</div>
            {(
              [
                ['hidden', 'on demand'],
                ['pinned', 'pinned — whiteboard'],
              ] as Array<['hidden' | 'pinned', string]>
            ).map(([tb, label]) => (
              <button
                key={tb}
                className={'row' + ((prefs.toolbar ?? 'hidden') === tb ? ' on' : '')}
                onClick={() => useBoard.getState().setPrefs({ toolbar: tb })}
              >
                {label}
              </button>
            ))}
            <div className="sep" />
            <div className="head">show</div>
            {(
              [
                ['all', 'everything'],
                ['mine', 'only mine'],
                ['accepted', 'accepted only'],
                ['pending', 'pending only'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={'row' + (filters.mode === mode ? ' on' : '')}
                onClick={() => useBoard.getState().setFilters({ mode })}
              >
                {label}
              </button>
            ))}
            {agents.length > 0 && (
              <>
                <div className="sep" />
                <div className="head">contributors</div>
                {agents.map((a) => {
                  const mark = agentMark(a)
                  const hidden = filters.hiddenAgents.includes(a)
                  return (
                    <button
                      key={a}
                      className={'row' + (hidden ? '' : ' on')}
                      onClick={() =>
                        useBoard.getState().setFilters({
                          hiddenAgents: hidden
                            ? filters.hiddenAgents.filter((x) => x !== a)
                            : [...filters.hiddenAgents, a],
                        })
                      }
                    >
                      <span style={{ color: mark.color }}>{mark.glyph}</span> {mark.label}
                      <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>
                        {hidden ? 'hidden' : ''}
                      </span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
