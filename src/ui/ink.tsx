import { create } from 'zustand'
import type { Stroke, XY } from '../types'
import { useBoard } from '../store'

/** Pen mode: draw / line / box / oval directly on the canvas, Excalidraw-style. */

export type PenTool = 'draw' | 'line' | 'rect' | 'ellipse'

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

export function strokePath(s: Pick<Stroke, 'kind' | 'points'>): ReturnType<typeof pathEl> {
  return pathEl(s)
}

function pathEl(s: Pick<Stroke, 'kind' | 'points'>) {
  const pts = s.points
  if (pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  switch (s.kind) {
    case 'draw':
      return <path d={'M ' + pts.map((p) => p.x + ' ' + p.y).join(' L ')} />
    case 'line':
      return <path d={'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y} />
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
  if (!strokes.length && !current) return null
  return (
    <svg className="ink" width="1" height="1">
      {strokes.map((s) => (
        <g key={s.id}>{strokePath(s)}</g>
      ))}
      {current && <g className="live">{strokePath(current)}</g>}
    </svg>
  )
}

export function PenBar() {
  const { pen, tool, setPen, setTool } = useInk()
  const strokes = useBoard((s) => s.strokes)
  if (!pen) return null

  const tools: Array<[PenTool, string, string]> = [
    ['draw', '✎', 'freehand'],
    ['line', '╱', 'line'],
    ['rect', '▭', 'box'],
    ['ellipse', '◯', 'oval'],
  ]
  return (
    <div className="chrome pen-bar">
      {tools.map(([t, glyph, label]) => (
        <button
          key={t}
          className={'pen-btn' + (tool === t ? ' on' : '')}
          title={label}
          onClick={() => setTool(t)}
        >
          {glyph}
        </button>
      ))}
      <span className="pen-sep" />
      <button
        className="pen-btn"
        title="undo stroke"
        disabled={!strokes.length}
        onClick={() => useBoard.getState().undoStroke()}
      >
        ↩
      </button>
      <button className="pen-btn done" title="done (Esc)" onClick={() => setPen(false)}>
        ✓
      </button>
    </div>
  )
}
