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

export type PenTool = 'draw' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'erase'

interface InkUi {
  pen: boolean
  tool: PenTool
  setPen(on: boolean): void
  setTool(t: PenTool): void
}

export const useInk = create<InkUi>((set) => ({
  pen: false,
  tool: 'draw',
  setPen: (pen) => set({ pen }),
  setTool: (tool) => set({ tool }),
}))

export function strokePath(s: Pick<Stroke, 'kind' | 'points'>) {
  const pts = s.points
  if (pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  switch (s.kind) {
    case 'draw':
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
  const pen = useInk((s) => s.pen)
  // the eraser leaves no trail of its own
  const live = current && current.kind !== 'erase' ? (current as Pick<Stroke, 'kind' | 'points'>) : null
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
  const { pen, tool, setPen, setTool } = useInk()
  const pinned = useBoard((s) => s.prefs.toolbar === 'pinned')
  const strokes = useBoard((s) => s.strokes)
  if (!pen && !pinned) return null

  const tools: Array<[PenTool, IconName, string]> = [
    ['draw', 'pen', 'freehand'],
    ['line', 'line', 'line'],
    ['rect', 'box', 'box'],
    ['ellipse', 'oval', 'oval'],
    ['arrow', 'arrow', 'arrow — card to card makes a link'],
    ['erase', 'erase', 'eraser — removes ink and links'],
  ]
  return (
    <div className="chrome pen-bar">
      {pinned && (
        <button
          className={'pen-btn' + (!pen ? ' on' : '')}
          title="move & select"
          onClick={() => setPen(false)}
        >
          <Icon name="move" />
        </button>
      )}
      {tools.map(([t, glyph, label]) => (
        <button
          key={t}
          className={'pen-btn' + (pen && tool === t ? ' on' : '')}
          title={label}
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
        disabled={!strokes.length}
        onClick={() => useBoard.getState().undoStroke()}
      >
        <Icon name="undo" />
      </button>
      {!pinned && (
        <button className="pen-btn done" title="done (Esc)" onClick={() => setPen(false)}>
          <Icon name="check" />
        </button>
      )}
    </div>
  )
}
