import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { XY } from '../types'
import { dropTarget, useBoard, visibleCards } from '../store'
import { cardSize, engineEvents } from '../engine/engine'
import { spatial } from '../engine/spatial'
import { ingestFiles, ingestText } from '../capture/ingest'
import { CardView } from './CardView'
import { InkLayer, useInk, type PenTool } from './ink'

interface View {
  x: number
  y: number
  k: number
}

interface Editing {
  at: XY
  cardId?: string
  initial?: string
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
  const style = useBoard((s) => s.prefs.style)
  const arrangement = useBoard((s) => s.prefs.arrangement)
  const pen = useInk((s) => s.pen)

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const boardRef = useRef<HTMLDivElement>(null)

  const [draggingCard, setDraggingCard] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [lasso, setLasso] = useState<XY[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [currentInk, setCurrentInk] = useState<{ kind: PenTool; points: XY[] } | null>(null)

  const gesture = useRef<{
    mode: 'pan' | 'card' | 'lasso' | 'ink' | null
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

  // Esc leaves pen mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useInk.getState().setPen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const startInk = (e: React.PointerEvent) => {
    ;(boardRef.current as HTMLElement).setPointerCapture(e.pointerId)
    const p = toWorld(e.clientX, e.clientY)
    gesture.current = { mode: 'ink', start: p, moved: false }
    setCurrentInk({ kind: useInk.getState().tool, points: [p] })
  }

  // ---- pointer gestures ----
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.note-editor')) return
    if (pen) {
      startInk(e)
      return
    }
    if (target.closest('[data-card]')) return
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
    if (pen) return // ink flows over cards; the board handler catches it
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
    } else if (g.mode === 'ink') {
      const p = toWorld(e.clientX, e.clientY)
      setCurrentInk((cur) =>
        cur
          ? {
              ...cur,
              points: cur.kind === 'draw' ? [...cur.points, p] : [cur.points[0], p],
            }
          : cur,
      )
    }
  }

  const cardAt = (p: XY): string | null => {
    const st = useBoard.getState()
    for (const c of visibleCards(st)) {
      const pos = st.positions[c.id]
      if (!pos) continue
      const { w, h } = cardSize(c)
      if (Math.abs(p.x - pos.x) <= w / 2 && Math.abs(p.y - pos.y) <= h / 2) return c.id
    }
    return null
  }

  const onUp = () => {
    const g = gesture.current
    if (g.mode === 'ink') {
      if (currentInk && currentInk.points.length > 1 && g.moved) {
        let inked = true
        if (currentInk.kind === 'arrow') {
          // Arrow landing on two cards is a relation, not ink — the same
          // link agents assert with link_cards, signed by the human.
          const a = currentInk.points[0]
          const b = currentInk.points[currentInk.points.length - 1]
          const from = cardAt(a)
          const to = cardAt(b)
          if (from && to && from !== to) {
            useBoard.getState().addLinks(
              [{ from, to, why: 'connected by hand', directed: true }],
              'human',
            )
            inked = false
          }
        }
        if (inked) {
          useBoard.getState().addStroke({ kind: currentInk.kind, points: currentInk.points })
        }
      }
      setCurrentInk(null)
    } else if (g.mode === 'lasso' && lasso && lasso.length > 2) {
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
    const onNewNote = () =>
      setEditing({ at: toWorld(window.innerWidth / 2, window.innerHeight / 2 - 60) })
    window.addEventListener('mundaneum:new-note', onNewNote)
    return () => window.removeEventListener('mundaneum:new-note', onNewNote)
  }, [toWorld])

  const onDoubleClick = (e: React.MouseEvent) => {
    if (pen) return
    const target = e.target as HTMLElement
    if (target.closest('.note-editor')) return
    const cardEl = target.closest('[data-card]') as HTMLElement | null
    if (cardEl) {
      // Double-click a text card: edit it in place.
      const id = cardEl.dataset.card!
      const card = useBoard.getState().cards[id]
      if (card?.type === 'text') {
        const at = useBoard.getState().positions[id] ?? toWorld(e.clientX, e.clientY)
        setEditing({ at, cardId: id, initial: card.content })
      }
      return
    }
    setEditing({ at: toWorld(e.clientX, e.clientY) })
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
      className={
        'board style-' + style + (panning ? ' panning' : '') + (pen ? ' penning' : '')
      }
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
          <defs>
            <marker
              id="mund-arrow"
              markerUnits="userSpaceOnUse"
              markerWidth="16"
              markerHeight="16"
              refX="11"
              refY="8"
              orient="auto"
            >
              <path d="M3 3 L11 8 L3 13" fill="none" stroke="context-stroke" strokeWidth="2" />
            </marker>
          </defs>
          {linkList.map((l) => {
            const a = positions[l.from]
            const b = positions[l.to]
            const cardB = useBoard.getState().cards[l.to]
            // Pull the tip out from under the target card so the head shows.
            const trim = cardB ? Math.max(...Object.values(cardSize(cardB))) / 2 + 14 : 0
            const dx = b.x - a.x
            const dy = b.y - a.y
            const len = Math.hypot(dx, dy) || 1
            const bx = l.directed ? b.x - (dx / len) * Math.min(trim, len * 0.4) : b.x
            const by = l.directed ? b.y - (dy / len) * Math.min(trim, len * 0.4) : b.y
            const mx = (a.x + bx) / 2
            const my = (a.y + by) / 2 - Math.min(60, len * 0.12)
            return (
              <path
                key={l.id}
                d={`M ${a.x} ${a.y} Q ${mx} ${my} ${bx} ${by}`}
                markerEnd={l.directed ? 'url(#mund-arrow)' : undefined}
                onClick={(e) => {
                  if (e.altKey) useBoard.getState().removeLink(l.id)
                }}
              >
                <title>
                  {l.why} — {l.addedBy} (alt-click to remove)
                </title>
              </path>
            )
          })}
        </svg>

        {arrangement === 'clusters' &&
          clusters.map((c) => {
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

        <InkLayer current={currentInk} />

        {editing && (
          <NoteEditor
            at={editing.at}
            initial={editing.initial}
            onDone={(text) => {
              const s = useBoard.getState()
              if (editing.cardId) {
                if (text.trim()) s.updateCard(editing.cardId, { content: text })
                else s.removeCard(editing.cardId)
              } else if (text.trim()) {
                s.addCards([{ content: text.trim(), at: editing.at }], 'human')
              }
              setEditing(null)
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

function NoteEditor({
  at,
  initial,
  onDone,
}: {
  at: XY
  initial?: string
  onDone: (text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    if (initial) ref.current?.setSelectionRange(initial.length, initial.length)
  }, [initial])
  return (
    <div className="note-editor" style={{ left: at.x, top: at.y }}>
      <textarea
        ref={ref}
        defaultValue={initial}
        placeholder={'write, then Enter\n- [ ] tasks and **markdown** work'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onDone((e.target as HTMLTextAreaElement).value)
          }
          if (e.key === 'Escape') onDone(initial ?? '')
        }}
        onBlur={(e) => onDone(e.target.value)}
      />
    </div>
  )
}
