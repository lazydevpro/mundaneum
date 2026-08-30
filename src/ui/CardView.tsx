import { memo } from 'react'
import type { Card, XY } from '../types'
import { agentMark } from '../agents/identity'
import { useBoard } from '../store'

/**
 * Provenance is the visual system, legible at 480p:
 *  - human card            -> solid border, no mark
 *  - agent card, accepted  -> solid border + that agent's mark
 *  - agent card, pending   -> dashed border + mark, hover to accept/reject
 */

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

export const CardView = memo(function CardView({
  card,
  pos,
  selected,
  dragging,
  onPointerDown,
}: {
  card: Card
  pos: XY
  selected: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
}) {
  const fromAgent = card.addedBy !== 'human'
  const mark = agentMark(card.addedBy)
  const cls = [
    'card',
    fromAgent && !card.accepted ? 'provisional' : '',
    selected ? 'selected' : '',
    dragging ? 'dragging' : '',
    (card.type === 'image' || card.type === 'sketch') && card.title ? 'has-caption' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{ left: pos.x, top: pos.y }}
      data-card={card.id}
      onPointerDown={(e) => onPointerDown(e, card.id)}
      title={fromAgent ? 'added by ' + mark.label + (card.accepted ? '' : ' — provisional') : undefined}
    >
      {card.type === 'image' || card.type === 'sketch' ? (
        <>
          <img src={card.content} alt={card.title ?? card.type} draggable={false} />
          {card.title && <div className="body">{card.title}</div>}
        </>
      ) : card.type === 'video' ? (
        <>
          <div className="video-face">▶</div>
          <div className="title">{card.title ?? 'video'}</div>
          <div className="host">{host(card.content)}</div>
        </>
      ) : card.type === 'link' ? (
        <div className="linkline">
          <div>
            {card.title && <div className="title">{card.title}</div>}
            <div className="body" style={{ WebkitLineClamp: 3 }}>
              {card.content}
            </div>
            <div className="host">{host(card.content)}</div>
          </div>
        </div>
      ) : card.type === 'file' ? (
        <>
          <div className="title">⌘ {card.title ?? 'file'}</div>
          <div className="host">{card.content}</div>
        </>
      ) : (
        <>
          {card.title && <div className="title">{card.title}</div>}
          <div className="body">{card.content}</div>
        </>
      )}

      {card.needs && <div className="needs">{card.needs}</div>}

      {fromAgent && (
        <span className="mark" style={{ background: mark.color }} aria-hidden>
          {mark.glyph}
        </span>
      )}

      {fromAgent && !card.accepted && (
        <div className="review" onPointerDown={(e) => e.stopPropagation()}>
          <button
            title={'accept (keep this ' + mark.label + ' card)'}
            onClick={() => useBoard.getState().acceptCard(card.id)}
          >
            ✓
          </button>
          <button title="reject (remove)" onClick={() => useBoard.getState().rejectCard(card.id)}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
})
