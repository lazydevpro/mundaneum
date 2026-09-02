import { useRef } from 'react'
import { create } from 'zustand'
import type { Stroke, XY } from '../types'
import { useBoard } from '../store'
import { Icon, type IconName } from './icons'

/**
 * Pen mode: draw / line / box / oval / arrow directly on the canvas.
 * An arrow whose ends land on two different cards becomes a real LINK —
 * the same relation agents assert with link_cards — not ink.
 * With prefs.toolbar = 'pinned', the rail stays on screen (whiteboard feel).
 */

export type PenTool = 'select' | 'draw' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'erase'

interface InkUi {
  pen: boolean
  penMode: boolean
  tool: PenTool
  documentId: string | null
  setPen(on: boolean): void
  setPenMode(on: boolean): void
  setTool(t: PenTool): void
  setDocument(id: string | null): void
}

export const useInk = create<InkUi>((set) => ({
  pen: false,
  penMode: false,
  tool: 'draw',
  documentId: null,
  setPen: (pen) => set(pen ? { pen } : { pen, penMode: false, documentId: null }),
  setPenMode: (penMode) => set({ penMode }),
  setTool: (tool) => set({ tool }),
  setDocument: (documentId) => set(documentId
    ? { documentId, pen: true }
    : { documentId: null, pen: false, penMode: false }),
}))

export function strokePath(s: Pick<Stroke, 'kind' | 'points' | 'text' | 'fontSize'>) {
  const pts = s.points
  if (s.kind === 'text') {
    const at = pts[0]
    if (!at || !s.text) return null
    const size = s.fontSize ?? 18
    return (
      <text x={at.x} y={at.y + size} fontSize={size}>
        {s.text.split('\n').map((line, index) => (
          <tspan key={index} x={at.x} dy={index ? size * 1.3 : 0}>{line || ' '}</tspan>
        ))}
      </text>
    )
  }
  if (pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  switch (s.kind) {
    case 'draw':
      if (pts.some((p) => p.pressure !== undefined)) {
        return (
          <>
            {pts.slice(1).map((p, index) => {
              const previous = pts[index]
              const pressure = Math.max(0, Math.min(1, p.pressure ?? previous.pressure ?? 0.5))
              return <path key={index} d={`M ${previous.x} ${previous.y} L ${p.x} ${p.y}`}
                style={{ strokeWidth: 1.1 + pressure * 3.1 }} />
            })}
          </>
        )
      }
      return <path d={'M ' + pts.map((p) => p.x + ' ' + p.y).join(' L ')} />
    case 'line':
      return <path d={'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y} />
    case 'arrow': {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const sz = 13
      const h1 = { x: b.x - sz * ux + sz * 0.55 * uy, y: b.y - sz * uy - sz * 0.55 * ux }
      const h2 = { x: b.x - sz * ux - sz * 0.55 * uy, y: b.y - sz * uy + sz * 0.55 * ux }
      return (
        <path
          d={
            'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y +
            ' M ' + h1.x + ' ' + h1.y + ' L ' + b.x + ' ' + b.y +
            ' L ' + h2.x + ' ' + h2.y
          }
        />
      )
    }
    case 'rect': {
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      return (
        <rect x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} rx={6} />
      )
    }
    case 'ellipse':
      return (
        <ellipse
          cx={(a.x + b.x) / 2}
          cy={(a.y + b.y) / 2}
          rx={Math.abs(b.x - a.x) / 2}
          ry={Math.abs(b.y - a.y) / 2}
        />
      )
  }
}

export function InkLayer({ current }: { current: { kind: PenTool; points: XY[] } | null }) {
  const strokes = useBoard((s) => s.strokes)
  const selected = useBoard((s) => s.strokeSelection)
  const pen = useInk((s) => s.pen || s.penMode)
  // the eraser leaves no trail of its own
  const live = current && current.kind !== 'erase' && current.kind !== 'text' && current.kind !== 'select'
    ? (current as Pick<Stroke, 'kind' | 'points'>)
    : null
  if (!strokes.length && !live) return null
  return (
    <svg className={'ink' + (pen ? '' : ' grabbable')} width="1" height="1">
      {strokes.map((s) => (
        <g key={s.id} className={selected.includes(s.id) ? 'picked' : undefined}>
          {strokePath(s)}
        </g>
      ))}
      {live && <g className="live">{strokePath(live)}</g>}
    </svg>
  )
}

export function PenBar() {
  const { pen, penMode, tool, documentId, setPen, setPenMode, setTool } = useInk()
  const pinned = useBoard((s) => s.prefs.toolbar === 'pinned')
  const strokes = useBoard((s) => s.strokes)
  const target = useBoard((s) => documentId ? s.cards[documentId] : undefined)
  const pos = useBoard((s) => s.prefs.toolbarPos)
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  /**
   * The rail is stored as a fraction of the viewport, not pixels, so it keeps
   * its place when the window resizes or the board opens on another screen.
   */
  const onGripDown = (e: React.PointerEvent) => {
    const bar = barRef.current
    if (!bar) return
    const r = bar.getBoundingClientRect()
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // No preventDefault here: it would swallow the dblclick that resets the
    // rail. Text selection is held off by user-select on the bar instead.
  }

  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current
    const bar = barRef.current
    if (!d || !bar) return
    const r = bar.getBoundingClientRect()
    const x = Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - r.width)
    const y = Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - r.height)
    useBoard.getState().setPrefs({
      toolbarPos: { x: x / window.innerWidth, y: y / window.innerHeight },
    })
  }

  const onGripUp = () => {
    drag.current = null
  }

  if (!pen && !pinned && !penMode) return null

  const placed = pos
    ? {
        left: Math.round(pos.x * window.innerWidth),
        top: Math.round(pos.y * window.innerHeight),
        right: 'auto' as const,
        bottom: 'auto' as const,
      }
    : undefined

  const tools: Array<[PenTool, IconName, string]> = [
    ...(documentId ? [['select', 'move', 'select and move document drawings'] as [PenTool, IconName, string]] : []),
    ['draw', 'pen', 'freehand'],
    ['line', 'line', 'line'],
    ['rect', 'box', 'box'],
    ['ellipse', 'oval', 'oval'],
    ['arrow', 'arrow', 'arrow — card to card makes a link'],
    ['text', 'text', documentId ? 'place text in the active document' : 'place a text note on the board'],
    ['erase', 'erase', 'eraser — removes ink and links'],
  ]
  return (
    <div className="chrome pen-bar" ref={barRef} style={placed}>
      <button
        className="pen-grip"
        title="drag to move · double-click to reset"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        onDoubleClick={() => useBoard.getState().setPrefs({ toolbarPos: undefined })}
      >
        <Icon name="grip" size={13} />
      </button>
      {pinned && !documentId && !penMode && (
        <button
          className={'pen-btn' + (!pen ? ' on' : '')}
          title="move & select"
          onClick={() => setPen(false)}
        >
          <Icon name="move" />
        </button>
      )}
      {penMode && (
        <button className="pen-btn" aria-label="Exit stylus mode and use touch" title="exit stylus mode and use touch" onClick={() => { setPenMode(false); setPen(false) }}>
          <Icon name="move" />
        </button>
      )}
      {documentId && <span className="pen-target" title={target?.title}>document</span>}
      {tools.map(([t, glyph, label]) => (
        <button
          key={t}
          className={'pen-btn' + ((pen || penMode) && tool === t ? ' on' : '')}
          title={documentId && t === 'arrow' ? 'arrow inside document' : documentId && t === 'erase' ? 'erase document drawing' : label}
          onClick={() => {
            setTool(t)
            setPen(true)
          }}
        >
          <Icon name={glyph} />
        </button>
      ))}
      <span className="pen-sep" />
      <button
        className="pen-btn"
        title="undo stroke"
        disabled={documentId ? !target?.document?.strokes.length : !strokes.length}
        onClick={() => {
          if (!documentId) return useBoard.getState().undoStroke()
          const card = useBoard.getState().cards[documentId]
          const document = card?.document
          if (!document?.strokes.length) return
          useBoard.getState().updateCard(documentId, {
            document: { ...document, strokes: document.strokes.slice(0, -1) },
          })
        }}
      >
        <Icon name="undo" />
      </button>
      {!pinned && (
        <button className="pen-btn done" title="done (Esc)" onClick={() => { setPen(false); setPenMode(false) }}>
          <Icon name="check" />
        </button>
      )}
    </div>
  )
}
