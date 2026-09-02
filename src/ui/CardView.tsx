import { memo, useRef, useState } from 'react'
import type { Card, XY } from '../types'
import { agentMark } from '../agents/identity'
import { useBoard } from '../store'
import { EmbedBody } from '../embed/EmbedBody'
import { cardWidth } from '../embed/dims'
import { hasMd, MdText } from './md'
import { Icon } from './icons'
import { DocumentCanvasCard } from './DocumentCanvasCard'

/**
 * Provenance is the visual system, legible at 480p:
 *  - human card            -> solid border, no mark
 *  - agent card, accepted  -> solid border + that agent's mark
 *  - agent card, pending   -> dashed border + mark, hover to accept/reject
 */

const EMBED_TYPES = new Set(['link', 'video', 'audio', 'social', 'sheet', 'doc', 'model', 'widget', 'file'])

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
  const [copied, setCopied] = useState(false)
  const fromAgent = card.addedBy !== 'human'
  const mark = agentMark(card.addedBy)
  const cls = [
    'card',
    'type-' + card.type,
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
      style={{ left: pos.x, top: pos.y, width: cardWidth(card) }}
      data-card={card.id}
      onPointerDown={(e) => onPointerDown(e, card.id)}
      title={fromAgent ? 'added by ' + mark.label + (card.accepted ? '' : ' — provisional') : undefined}
    >
      {card.type === 'canvas' ? (
        <DocumentCanvasCard card={card} />
      ) : card.type === 'image' || card.type === 'sketch' ? (
        <>
          <img src={card.content} alt={card.title ?? card.type} draggable={false} />
          {card.title && <div className="body">{card.title}</div>}
        </>
      ) : EMBED_TYPES.has(card.type) ? (
        <EmbedBody card={card} />
      ) : (
        <>
          {card.title && <div className="title">{card.title}</div>}
          {hasMd(card.content) ? (
            <div className="body md-body">
              <MdText text={card.content} cardId={card.id} />
            </div>
          ) : (
            <div className="body">{card.content}</div>
          )}
        </>
      )}

      {card.needs && <div className="needs">{card.needs}</div>}

      {card.type === 'widget' && <WidgetResizer card={card} />}

      <button
        className="copy-card-id"
        title={'Copy card ID: ' + card.id}
        aria-label={'Copy card ID ' + card.id}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation()
          await navigator.clipboard.writeText(card.id)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'copied' : 'ID'}
      </button>

      <button
        className="delete-card"
        title={'Delete card ' + card.id}
        aria-label={'Delete card ' + (card.title ?? card.id)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          useBoard.getState().removeCard(card.id)
        }}
      >
        <Icon name="x" size={11} />
      </button>

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
            <Icon name="check" size={12} />
          </button>
          <button title="reject (remove)" onClick={() => useBoard.getState().rejectCard(card.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  )
})

function WidgetResizer({ card }: { card: Card }) {
  const start = useRef<{
    pointerId: number
    x: number
    y: number
    width: number
    height: number
    scale: number
  } | null>(null)
  return (
    <button
      className="widget-resize"
      aria-label={'Resize widget ' + (card.title ?? card.id)}
      title="Drag to resize"
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const cardEl = e.currentTarget.closest('[data-card]') as HTMLElement | null
        const logicalWidth = card.displaySize?.width ?? 320
        start.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          width: logicalWidth,
          height: card.displaySize?.height ?? 360,
          scale: (cardEl?.getBoundingClientRect().width ?? logicalWidth) / logicalWidth,
        }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s || s.pointerId !== e.pointerId) return
        useBoard.getState().updateCard(card.id, {
          displaySize: {
            width: Math.max(260, Math.min(900, s.width + (e.clientX - s.x) / s.scale)),
            height: Math.max(220, Math.min(700, s.height + (e.clientY - s.y) / s.scale)),
          },
        })
      }}
      onPointerUp={() => { start.current = null }}
      onPointerCancel={() => { start.current = null }}
    />
  )
}
