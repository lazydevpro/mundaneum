import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { XY } from '../types'
import { dropTarget, useBoard, visibleCards } from '../store'
import { cardSize, engineEvents } from '../engine/engine'
import { spatial } from '../engine/spatial'
import { ingestFiles, ingestText } from '../capture/ingest'
import { CardView } from './CardView'

interface View {
  x: number
  y: number
  k: number
}

export function Canvas() {
  const cardsMap = useBoard((s) => s.cards)
  const filters = useBoard((s) => s.filters)
  const cards = useMemo(
    () => visibleCards({ cards: cardsMap, filters }),
    [cardsMap, filters],
  )
  const positions = useBoard((s) => s.positions)
  const links = useBoard((s) => s.links)
  const clusters = useBoard((s) => s.clusters)
  const selection = useBoard((s) => s.selection)

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const boardRef = useRef<HTMLDivElement>(null)

  const [draggingCard, setDraggingCard] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [lasso, setLasso] = useState<XY[] | null>(null)
  const [editorAt, setEditorAt] = useState<XY | null>(null)

  const gesture = useRef<{
    mode: 'pan' | 'card' | 'lasso' | null
    id?: string
    start: XY
    startView?: View
    cardStart?: XY
    moved: boolean
  }>({ mode: null, start: { x: 0, y: 0 }, moved: false })

  const toWorld = useCallback((sx: number, sy: number): XY => {
    const v = viewRef.current
    return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k }
  }, [])

  // New cards land near the viewport center.
  useEffect(() => {
    dropTarget.current = () => toWorld(window.innerWidth / 2, window.innerHeight / 2 - 40)
  }, [toWorld])

  // Keep the spatial index fresh so lasso + region queries stay honest.
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useBoard.getState()
      spatial.rebuild(
        visibleCards(s).map((c) => {
          const p = s.positions[c.id] ?? { x: 0, y: 0 }
          const { w, h } = cardSize(c)
          return { id: c.id, x: p.x, y: p.y, w, h }
        }),
      )
    }, 350)
    return () => clearTimeout(t)
  }, [positions, cards.length, filters])

  // Fit the camera to the whole board — on load, and after each organize.
  useEffect(() => {
    const fit = () => {
      const s = useBoard.getState()
      const pts = Object.values(s.positions)
      if (!pts.length) return
      const minX = Math.min(...pts.map((p) => p.x)) - 260
      const maxX = Math.max(...pts.map((p) => p.x)) + 260
      const minY = Math.min(...pts.map((p) => p.y)) - 220
      const maxY = Math.max(...pts.map((p) => p.y)) + 220
      const availH = window.innerHeight - 130
      const k = Math.min(
        1,
        (window.innerWidth - 40) / (maxX - minX),
        availH / (maxY - minY),
      )
      setView({
        k,
        x: window.innerWidth / 2 - ((minX + maxX) / 2) * k,
        y: 40 + availH / 2 - ((minY + maxY) / 2) * k,
      })
    }
    const focusCard = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const p = useBoard.getState().positions[id]
      if (!p) return
      setView({ k: 1, x: window.innerWidth / 2 - p.x, y: window.innerHeight / 2 - p.y })
    }
    fit()
    engineEvents.addEventListener('organized', fit)
    window.addEventListener('mundaneum:fit', fit)
    window.addEventListener('mundaneum:focus-card', focusCard)
    return () => {
      engineEvents.removeEventListener('organized', fit)
      window.removeEventListener('mundaneum:fit', fit)
      window.removeEventListener('mundaneum:focus-card', focusCard)
    }
  }, [])

  // ---- wheel: pan; ctrl/cmd+wheel or pinch: zoom around cursor ----
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0022)
        const k = Math.min(2.5, Math.max(0.12, v.k * factor))
        const wx = (e.clientX - v.x) / v.k
        const wy = (e.clientY - v.y) / v.k
        setView({ k, x: e.clientX - wx * k, y: e.clientY - wy * k })
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- pointer gestures ----
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-card]') || target.closest('.note-editor')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.shiftKey) {
      const p = toWorld(e.clientX, e.clientY)
      gesture.current = { mode: 'lasso', start: p, moved: false }
      setLasso([p])
    } else {
      gesture.current = {
        mode: 'pan',
        start: { x: e.clientX, y: e.clientY },
        startView: { ...viewRef.current },
        moved: false,
      }
      setPanning(true)
    }
  }

  const onCardDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    boardRef.current?.setPointerCapture(e.pointerId)
    const p = useBoard.getState().positions[id] ?? { x: 0, y: 0 }
    gesture.current = {
      mode: 'card',
      id,
      start: { x: e.clientX, y: e.clientY },
      cardStart: { ...p },
      moved: false,
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g.mode) return
    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true

    if (g.mode === 'pan' && g.startView) {
      setView({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy })
    } else if (g.mode === 'card' && g.id && g.cardStart) {
      if (g.moved && draggingCard !== g.id) setDraggingCard(g.id)
      const k = viewRef.current.k
      useBoard.getState().moveCard(g.id, { x: g.cardStart.x + dx / k, y: g.cardStart.y + dy / k })
    } else if (g.mode === 'lasso') {
      const p = toWorld(e.clientX, e.clientY)
      setLasso((prev) => (prev ? [...prev, p] : [p]))
    }
  }

  const onUp = () => {
    const g = gesture.current
    if (g.mode === 'lasso' && lasso && lasso.length > 2) {
      useBoard.getState().setSelection(spatial.searchPolygon(lasso))
    } else if (g.mode === 'card' && g.id && !g.moved) {
      const sel = useBoard.getState().selection
      useBoard.getState().setSelection(sel.includes(g.id) ? [] : [g.id])
    } else if (g.mode === 'pan' && !g.moved) {
      useBoard.getState().setSelection([])
    }
    gesture.current = { mode: null, start: { x: 0, y: 0 }, moved: false }
    setPanning(false)
    setLasso(null)
    setDraggingCard(null)
  }

  useEffect(() => {
    const onNewNote = () => setEditorAt(toWorld(window.innerWidth / 2, window.innerHeight / 2 - 60))
    window.addEventListener('mundaneum:new-note', onNewNote)
    return () => window.removeEventListener('mundaneum:new-note', onNewNote)
  }, [toWorld])

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-card]') || target.closest('.note-editor')) return
    setEditorAt(toWorld(e.clientX, e.clientY))
  }

  // ---- drag & drop files onto the canvas ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const at = toWorld(e.clientX, e.clientY)
    if (e.dataTransfer.files.length) {
      void ingestFiles(e.dataTransfer.files, at)
      return
    }
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (uri) ingestText(uri, at)
  }

  const linkList = Object.values(links).filter(
    (l) => positions[l.from] && positions[l.to] && !useBoard.getState().cards[l.from]?.mergedInto,
  )

  return (
    <div
      ref={boardRef}
      className={'board' + (panning ? ' panning' : '')}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {cards.length === 0 && (
        <div className="hint-center">
          <div className="inner">
            <div className="h">Dump anything here.</div>
            paste text · drop files · double-click to write
            <br />
            agents organize — they may contribute anything except position
          </div>
        </div>
      )}

      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="links" width="1" height="1">
          {linkList.map((l) => {
            const a = positions[l.from]
            const b = positions[l.to]
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
            return (
              <path key={l.id} d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}>
                <title>
                  {l.why} — {l.addedBy}
                </title>
              </path>
            )
          })}
        </svg>

        {clusters.map((c) => {
          const pts = c.cardIds.map((id) => positions[id]).filter(Boolean)
          if (!pts.length) return null
          const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
          const top = Math.min(...pts.map((p) => p.y))
          return (
            <div
              key={c.id}
              className="cluster-label"
              style={{
                left: cx,
                top: top - 40 - 30 / view.k,
                transform: 'translate(-50%, -50%) scale(' + 1 / view.k + ')',
              }}
            >
              {c.label ?? '·  ·  ·'}
              {c.label && c.labeledBy && <span className="by">{c.labeledBy}</span>}
            </div>
          )
        })}

        {cards.map((c) => (
          <CardView
            key={c.id}
            card={c}
            pos={positions[c.id] ?? { x: 0, y: 0 }}
            selected={selection.includes(c.id)}
            dragging={draggingCard === c.id}
            onPointerDown={onCardDown}
          />
        ))}

        {editorAt && (
          <NoteEditor
            at={editorAt}
            onDone={(text) => {
              if (text.trim()) {
                useBoard.getState().addCards([{ content: text.trim(), at: editorAt }], 'human')
              }
              setEditorAt(null)
            }}
          />
        )}

        {lasso && lasso.length > 1 && (
          <svg className="lasso" width="1" height="1">
            <path d={'M ' + lasso.map((p) => p.x + ' ' + p.y).join(' L ') + ' Z'} />
          </svg>
        )}
      </div>
    </div>
  )
}

function NoteEditor({ at, onDone }: { at: XY; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="note-editor" style={{ left: at.x, top: at.y }}>
      <textarea
        ref={ref}
        placeholder="write, then Enter"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onDone((e.target as HTMLTextAreaElement).value)
          }
          if (e.key === 'Escape') onDone('')
        }}
        onBlur={(e) => onDone(e.target.value)}
      />
    </div>
  )
}
