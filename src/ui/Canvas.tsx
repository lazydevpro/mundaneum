import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { XY } from '../types'
import { dropTarget, useBoard, visibleCards } from '../store'
import { cardSize, engineEvents } from '../engine/engine'
import { spatial } from '../engine/spatial'
import { ingestFiles, ingestText } from '../capture/ingest'
import { classifyUrl } from '../embed/providers'
import { enrichCard } from '../embed/unfurl'
import { CardView } from './CardView'
import { InkLayer, useInk, type PenTool } from './ink'
import { isDirectDisplayPen, pointerSamples } from './pointer'

interface View {
  x: number
  y: number
  k: number
}

interface Editing {
  at: XY
  cardId?: string
  initial?: string
  plain?: boolean
  strokeId?: string
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
  const annotations = useBoard((s) => s.annotations)
  const style = useBoard((s) => s.prefs.style)
  const arrangement = useBoard((s) => s.prefs.arrangement)
  const pen = useInk((s) => s.pen)
  const penMode = useInk((s) => s.penMode)

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
    mode: 'pan' | 'card' | 'lasso' | 'ink' | 'pinch' | 'stroke' | null
    id?: string
    pointerId?: number
    inkTool?: PenTool
    strokeIds?: string[]
    last?: XY
    start: XY
    startView?: View
    cardStart?: XY
    additive?: boolean
    wasSelected?: boolean
    moved: boolean
  }>({ mode: null, start: { x: 0, y: 0 }, moved: false })

  /** Nearest drawing under a world point, if any is close enough to grab. */
  const hitStroke = (p: XY): string | null => {
    const r = 12 / viewRef.current.k
    for (const s of [...useBoard.getState().strokes].reverse()) {
      if (s.kind === 'text' && s.points[0]) {
        const size = s.fontSize ?? 18
        const lines = (s.text ?? '').split('\n')
        const width = Math.max(1, ...lines.map((line) => line.length)) * size * 0.62
        const height = Math.max(1, lines.length) * size * 1.3
        if (p.x >= s.points[0].x - r && p.x <= s.points[0].x + width + r &&
            p.y >= s.points[0].y - r && p.y <= s.points[0].y + height + r) return s.id
        continue
      }
      const pts =
        s.kind === 'rect' || s.kind === 'ellipse'
          ? rectOutline(s.points[0], s.points[s.points.length - 1])
          : s.points
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSeg(p, pts[i], pts[i + 1]) < r) return s.id
      }
    }
    return null
  }

  // Live pointers (touch): two fingers anywhere = pinch zoom + pan.
  const pointers = useRef(new Map<number, XY>())
  const pinch0 = useRef<{ dist: number; mid: XY; view: View } | null>(null)

  const beginPinchIfTwo = () => {
    if (pointers.current.size !== 2) return false
    const [a, b] = [...pointers.current.values()]
    pinch0.current = {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...viewRef.current },
    }
    // A second finger cancels whatever was in flight (uncommitted ink included).
    gesture.current = { mode: 'pinch', start: { x: 0, y: 0 }, moved: true }
    setCurrentInk(null)
    setLasso(null)
    setPanning(false)
    setDraggingCard(null)
    return true
  }

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
      if (e.key === 'Escape') {
        useInk.getState().setPen(false)
        useInk.getState().setPenMode(false)
      }
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

  const capture = (e: React.PointerEvent) => {
    try {
      boardRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* some pointers (synthetic, or mid-gesture on iOS) refuse capture */
    }
  }

  const release = (e: React.PointerEvent) => {
    try {
      if (boardRef.current?.hasPointerCapture(e.pointerId)) boardRef.current.releasePointerCapture(e.pointerId)
    } catch {
      /* WebKit can implicitly release capture before pointerup/cancel arrives. */
    }
  }

  const interruptGesture = () => {
    pointers.current.clear()
    pinch0.current = null
    gesture.current = { mode: null, start: { x: 0, y: 0 }, moved: false }
    setCurrentInk(null)
    setLasso(null)
    setPanning(false)
    setDraggingCard(null)
  }

  const startInk = (e: React.PointerEvent, requestedTool = useInk.getState().tool) => {
    if (requestedTool === 'text' || requestedTool === 'select') return
    capture(e)
    const p = {
      ...toWorld(e.clientX, e.clientY),
      ...(e.pointerType === 'pen' ? { pressure: e.pressure } : {}),
    }
    gesture.current = { mode: 'ink', pointerId: e.pointerId, inkTool: requestedTool, start: p, moved: false }
    setCurrentInk({ kind: requestedTool, points: [p] })
  }

  // ---- pointer gestures ----
  const onBackgroundDown = (e: React.PointerEvent) => {
    const hardwareEraser = e.pointerType === 'pen' && e.button === 5
    if (e.button !== 0 && !hardwareEraser) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.note-editor, .canvas-text-editor')) return
    // A document owns pen gestures while it is the active drawing container.
    if (useInk.getState().documentId) return
    const inkUi = useInk.getState()
    if (isDirectDisplayPen(e.nativeEvent)) {
      // Match tldraw: a direct-display stylus interrupts any palm gesture
      // before its own stroke begins, then canvas touches are rejected.
      interruptGesture()
      inkUi.setPenMode(true)
      if (e.cancelable) e.preventDefault()
    } else if (inkUi.penMode && e.pointerType !== 'pen') {
      return
    }
    // Only fingers participate in pinch state. A pen must never become one
    // half of a pen+palm pinch gesture.
    if (e.pointerType === 'touch') {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (beginPinchIfTwo()) return
    }
    if (inkUi.pen && inkUi.tool === 'text') {
      // Text placement is a one-click editor gesture, not a pan/ink gesture.
      // Clear any previous pointer state so the following pointer-up cannot
      // finish an older gesture and dismiss the newly opened editor.
      gesture.current = { mode: null, start: { x: 0, y: 0 }, moved: false }
      setPanning(false)
      setLasso(null)
      setEditing({ at: toWorld(e.clientX, e.clientY), plain: true })
      useInk.getState().setPen(false)
      return
    }
    // A direct-display stylus draws even outside manual draw mode; fingers navigate.
    if ((pen || e.pointerType === 'pen') && (hardwareEraser || !['text', 'select'].includes(useInk.getState().tool))) {
      startInk(e, hardwareEraser ? 'erase' : useInk.getState().tool)
      return
    }
    if (target?.closest?.('[data-card]')) return

    // Drawings behave like cards: click to select, drag to move.
    const world = toWorld(e.clientX, e.clientY)
    const hit = hitStroke(world)
    if (hit) {
      capture(e)
      const sel = useBoard.getState().strokeSelection
      const wasSelected = sel.includes(hit)
      const moving = wasSelected ? sel : (e.shiftKey ? [...sel, hit] : [hit])
      if (!wasSelected) useBoard.getState().setStrokeSelection(moving)
      gesture.current = {
        mode: 'stroke',
        id: hit,
        pointerId: e.pointerId,
        strokeIds: moving,
        start: { x: e.clientX, y: e.clientY },
        last: world,
        additive: e.shiftKey,
        wasSelected,
        moved: false,
      }
      return
    }

    capture(e)
    if (e.shiftKey) {
      const p = toWorld(e.clientX, e.clientY)
      gesture.current = { mode: 'lasso', pointerId: e.pointerId, start: p, moved: false }
      setLasso([p])
    } else {
      gesture.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        startView: { ...viewRef.current },
        moved: false,
      }
      setPanning(true)
    }
  }

  const onCardDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    if (useInk.getState().penMode && e.pointerType !== 'pen') return
    if (pen || e.pointerType === 'pen') return // ink flows over cards; the board handler catches it
    if (pointers.current.size >= 1) {
      // second finger landing on a card: let it reach the board for pinch
      return
    }
    e.stopPropagation()
    capture(e)
    const p = useBoard.getState().positions[id] ?? { x: 0, y: 0 }
    gesture.current = {
      mode: 'card',
      id,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      cardStart: { ...p },
      additive: e.shiftKey,
      moved: false,
    }
  }

  const onMove = (e: React.PointerEvent) => {
    if (useInk.getState().penMode && e.pointerType !== 'pen') return
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    const g = gesture.current
    if (!g.mode) return
    if (g.mode !== 'pinch' && g.pointerId !== undefined && g.pointerId !== e.pointerId) return
    if (e.pointerType === 'pen' && e.cancelable) e.preventDefault()

    if (g.mode === 'pinch') {
      const p0 = pinch0.current
      if (!p0 || pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = Math.min(2.5, Math.max(0.12, p0.view.k * (dist / p0.dist)))
      // keep the world point that started under the fingers under them still
      const wx = (p0.mid.x - p0.view.x) / p0.view.k
      const wy = (p0.mid.y - p0.view.y) / p0.view.k
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k })
      return
    }

    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true

    if (g.mode === 'pan' && g.startView) {
      setView({ ...g.startView, x: g.startView.x + dx, y: g.startView.y + dy })
    } else if (g.mode === 'card' && g.id && g.cardStart) {
      if (g.moved && draggingCard !== g.id) setDraggingCard(g.id)
      const k = viewRef.current.k
      useBoard.getState().moveCard(g.id, { x: g.cardStart.x + dx / k, y: g.cardStart.y + dy / k })
    } else if (g.mode === 'stroke' && g.strokeIds && g.last) {
      const p = toWorld(e.clientX, e.clientY)
      useBoard.getState().moveStrokes(g.strokeIds, p.x - g.last.x, p.y - g.last.y)
      g.last = p
    } else if (g.mode === 'lasso') {
      const p = toWorld(e.clientX, e.clientY)
      setLasso((prev) => (prev ? [...prev, p] : [p]))
    } else if (g.mode === 'ink') {
      const samples = pointerSamples(e.nativeEvent)
      if (g.inkTool === 'erase') {
        for (const sample of samples) eraseAt(toWorld(sample.clientX, sample.clientY))
        return
      }
      const points = samples.map((sample) => ({
        ...toWorld(sample.clientX, sample.clientY),
        ...(e.pointerType === 'pen' ? { pressure: sample.pressure ?? e.pressure } : {}),
      }))
      setCurrentInk((cur) =>
        cur
          ? {
              ...cur,
              points: cur.kind === 'draw'
                ? [...cur.points, ...points]
                : [cur.points[0], points[points.length - 1]],
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

  /** Eraser: removes ink strokes and links the pointer crosses. */
  const eraseAt = (p: XY) => {
    const st = useBoard.getState()
    const r = 14 / viewRef.current.k
    const deadStrokes = st.strokes
      .filter((stroke) => {
        if (stroke.kind === 'text' && stroke.points[0]) {
          const size = stroke.fontSize ?? 18
          const lines = (stroke.text ?? '').split('\n')
          const width = Math.max(1, ...lines.map((line) => line.length)) * size * 0.62
          const height = Math.max(1, lines.length) * size * 1.3
          return p.x >= stroke.points[0].x - r && p.x <= stroke.points[0].x + width + r &&
            p.y >= stroke.points[0].y - r && p.y <= stroke.points[0].y + height + r
        }
        const pts =
          stroke.kind === 'rect' || stroke.kind === 'ellipse'
            ? rectOutline(stroke.points[0], stroke.points[stroke.points.length - 1])
            : stroke.points
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSeg(p, pts[i], pts[i + 1]) < r) return true
        }
        return false
      })
      .map((x) => x.id)
    if (deadStrokes.length) st.removeStrokes(deadStrokes)

    const deadAnnots = st.annotations
      .filter((an) => {
        const pts = an.cardIds
          .map((id) => {
            const pos = st.positions[id]
            const c = st.cards[id]
            if (!pos || !c) return null
            const { w, h } = cardSize(c)
            return { pos, w, h }
          })
          .filter((x): x is { pos: XY; w: number; h: number } => Boolean(x))
        if (!pts.length) return false
        const minX = Math.min(...pts.map((x) => x.pos.x - x.w / 2)) - 22
        const maxX = Math.max(...pts.map((x) => x.pos.x + x.w / 2)) + 22
        const minY = Math.min(...pts.map((x) => x.pos.y - x.h / 2)) - 22
        const maxY = Math.max(...pts.map((x) => x.pos.y + x.h / 2)) + 22
        const outline = rectOutline({ x: minX, y: minY }, { x: maxX, y: maxY })
        for (let i = 0; i < outline.length - 1; i++) {
          if (distToSeg(p, outline[i], outline[i + 1]) < r) return true
        }
        return false
      })
      .map((an) => an.id)
    if (deadAnnots.length) st.removeAnnotations(deadAnnots)

    for (const l of Object.values(st.links)) {
      const a = st.positions[l.from]
      const b = st.positions[l.to]
      if (!a || !b) continue
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
      for (let t = 0; t < 1; t += 1 / 14) {
        const q1 = quadPoint(a, { x: mx, y: my }, b, t)
        const q2 = quadPoint(a, { x: mx, y: my }, b, Math.min(1, t + 1 / 14))
        if (distToSeg(p, q1, q2) < r) {
          st.removeLink(l.id)
          break
        }
      }
    }
  }

  const onUp = (e?: React.PointerEvent) => {
    if (e) {
      pointers.current.delete(e.pointerId)
      if (useInk.getState().penMode && e.pointerType !== 'pen') return
      if (gesture.current.mode !== 'pinch' && gesture.current.pointerId !== undefined && gesture.current.pointerId !== e.pointerId) return
      if (e.pointerType === 'pen' && e.cancelable) e.preventDefault()
      release(e)
    }
    const g = gesture.current
    if (g.mode === 'pinch') {
      if (pointers.current.size < 2) {
        pinch0.current = null
        gesture.current = { mode: null, start: { x: 0, y: 0 }, moved: false }
      }
      return
    }
    if (g.mode === 'ink') {
      if (currentInk && currentInk.kind !== 'erase' && currentInk.points.length > 1 && g.moved) {
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
          if (currentInk.kind !== 'text' && currentInk.kind !== 'select') {
            useBoard.getState().addStroke({ kind: currentInk.kind, points: currentInk.points })
          }
        }
      }
      setCurrentInk(null)
    } else if (g.mode === 'stroke') {
      // A click without a drag toggles that drawing's selection.
      if (!g.moved && g.id) {
        const sel = useBoard.getState().strokeSelection
        if (g.additive) {
          // An unselected shift-click was already added on pointer-down so it
          // can immediately take part in a group drag. A selected one toggles off.
          if (g.wasSelected) useBoard.getState().setStrokeSelection(sel.filter((id) => id !== g.id))
        } else {
          useBoard.getState().setStrokeSelection(sel.length === 1 && sel[0] === g.id ? [] : [g.id])
        }
      }
    } else if (g.mode === 'lasso' && lasso && lasso.length > 2) {
      useBoard.getState().setSelection(spatial.searchPolygon(lasso))
      // The lasso catches drawings too, not just cards.
      useBoard.getState().setStrokeSelection(
        useBoard.getState().strokes
          .filter((s) => s.points.some((p) => pointInPolygon(p, lasso)))
          .map((s) => s.id),
      )
    } else if (g.mode === 'card' && g.id && !g.moved) {
      const sel = useBoard.getState().selection
      if (g.additive) {
        useBoard.getState().setSelection(
          sel.includes(g.id) ? sel.filter((id) => id !== g.id) : [...sel, g.id],
        )
      } else {
        useBoard.getState().setSelection(sel.length === 1 && sel[0] === g.id ? [] : [g.id])
      }
    } else if (g.mode === 'pan' && !g.moved) {
      useBoard.getState().setSelection([])
    }
    gesture.current = { mode: null, start: { x: 0, y: 0 }, moved: false }
    setPanning(false)
    setLasso(null)
    setDraggingCard(null)
  }
  const onCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    release(e)
    // Cancelled input never commits ink. Clear all transient interaction state
    // so the next stylus contact cannot inherit a stale touch or pinch.
    if (gesture.current.mode === 'pinch' || gesture.current.pointerId === e.pointerId) interruptGesture()
  }

  useEffect(() => {
    const interruptForDocumentStylus = () => interruptGesture()
    window.addEventListener('mundaneum:stylus-start', interruptForDocumentStylus)
    return () => window.removeEventListener('mundaneum:stylus-start', interruptForDocumentStylus)
  }, [])

  useEffect(() => {
    const onNewNote = () =>
      setEditing({ at: toWorld(window.innerWidth / 2, window.innerHeight / 2 - 60) })
    const onNewCanvasDocument = () => {
      const s = useBoard.getState()
      const [card] = s.addCards(
        [{
          type: 'canvas',
          title: 'Document canvas',
          content: '',
          document: { text: '', strokes: [], width: 360, height: 270, canvasWidth: 342, canvasHeight: 270 },
          at: toWorld(window.innerWidth / 2, window.innerHeight / 2 - 60),
        }],
        'human',
      )
      s.setSelection([card.id])
    }
    window.addEventListener('mundaneum:new-note', onNewNote)
    window.addEventListener('mundaneum:new-canvas-document', onNewCanvasDocument)
    return () => {
      window.removeEventListener('mundaneum:new-note', onNewNote)
      window.removeEventListener('mundaneum:new-canvas-document', onNewCanvasDocument)
    }
  }, [toWorld])

  const onDoubleClick = (e: React.MouseEvent) => {
    if (pen) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.note-editor, .canvas-text-editor')) return
    const cardEl = target?.closest?.('[data-card]') as HTMLElement | null
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
    const at = toWorld(e.clientX, e.clientY)
    const strokeId = hitStroke(at)
    const stroke = strokeId ? useBoard.getState().strokes.find((candidate) => candidate.id === strokeId) : undefined
    if (stroke?.kind === 'text') {
      setEditing({ at: stroke.points[0], initial: stroke.text ?? '', plain: true, strokeId: strokeId ?? undefined })
      return
    }
    setEditing({ at })
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
        'board style-' + style + (panning ? ' panning' : '') + ((pen || penMode) ? ' penning' : '')
      }
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
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

        {annotations.length > 0 && (
          <svg className="annots" width="1" height="1">
            {annotations.map((an) => {
              const pts = an.cardIds
                .map((id) => {
                  const p = positions[id]
                  const c = useBoard.getState().cards[id]
                  if (!p || !c || c.mergedInto) return null
                  const { w, h } = cardSize(c)
                  return { p, w, h }
                })
                .filter((x): x is { p: XY; w: number; h: number } => Boolean(x))
              if (!pts.length) return null
              const minX = Math.min(...pts.map((x) => x.p.x - x.w / 2)) - 22
              const maxX = Math.max(...pts.map((x) => x.p.x + x.w / 2)) + 22
              const minY = Math.min(...pts.map((x) => x.p.y - x.h / 2)) - 22
              const maxY = Math.max(...pts.map((x) => x.p.y + x.h / 2)) + 22
              return (
                <g key={an.id}>
                  {an.kind === 'circle' ? (
                    <ellipse
                      cx={(minX + maxX) / 2}
                      cy={(minY + maxY) / 2}
                      rx={((maxX - minX) / 2) * 1.12}
                      ry={((maxY - minY) / 2) * 1.18}
                    />
                  ) : (
                    <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={16} />
                  )}
                  {an.note && (
                    <text x={minX + 6} y={minY - 10}>
                      {an.note} — {an.by}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}

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

        {editing && (() => {
          const finish = (text: string) => {
            const s = useBoard.getState()
            if (editing.plain) {
              if (editing.strokeId) {
                if (text.trim()) s.updateStroke(editing.strokeId, { text })
                else s.removeStrokes([editing.strokeId])
              } else if (text.trim()) {
                s.addStroke({ kind: 'text', points: [{ ...editing.at }], text, fontSize: 18 })
              }
            } else if (editing.cardId) {
              if (!text.trim()) s.removeCard(editing.cardId)
              else if (text.trim() !== editing.initial) {
                s.updateCard(editing.cardId, { content: text })
                // Typed a bare URL into a note? It should become a link
                // card with a preview, exactly as pasting one does.
                reclassifyIfUrl(editing.cardId, text.trim())
              }
            } else if (text.trim()) {
              // Same path as paste and drop, so a typed URL unfurls too.
              ingestText(text.trim(), editing.at)
            }
            setEditing(null)
          }
          return editing.plain
            ? <CanvasTextEditor at={editing.at} initial={editing.initial} onDone={finish} />
            : <NoteEditor at={editing.at} initial={editing.initial} onDone={finish} />
        })()}

        {lasso && lasso.length > 1 && (
          <svg className="lasso" width="1" height="1">
            <path d={'M ' + lasso.map((p) => p.x + ' ' + p.y).join(' L ') + ' Z'} />
          </svg>
        )}
      </div>
    </div>
  )
}

/** An edited note that is now just a URL becomes a proper link card. */
function reclassifyIfUrl(cardId: string, text: string): void {
  if (!/^https?:\/\/\S+$/.test(text) || /\s/.test(text)) return
  const cls = classifyUrl(text)
  const card = useBoard.getState().cards[cardId]
  useBoard.getState().updateCard(cardId, {
    type: cls.type,
    meta: { ...card?.meta, ...cls.meta, unfurled: false },
  })
  enrichCard(cardId)
}

function distToSeg(p: XY, a: XY, b: XY): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

function quadPoint(a: XY, m: XY, b: XY, t: number): XY {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * m.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * m.y + t * t * b.y,
  }
}

function rectOutline(a: XY, b: XY): XY[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]
}

function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function CanvasTextEditor({
  at,
  initial,
  onDone,
}: {
  at: XY
  initial?: string
  onDone: (text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const focusReady = useRef(false)
  useEffect(() => {
    // Focus after the placement click has completely finished. Otherwise the
    // browser's final click-focus step can immediately blur and close a new,
    // still-empty editor.
    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus()
      if (initial) ref.current?.setSelectionRange(initial.length, initial.length)
      focusReady.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initial])

  return (
    <div className="canvas-text-editor" style={{ left: at.x, top: at.y }}>
      <textarea
        ref={ref}
        defaultValue={initial}
        rows={1}
        placeholder="Type…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onDone((e.target as HTMLTextAreaElement).value)
          }
          if (e.key === 'Escape') onDone(initial ?? '')
        }}
        onBlur={(e) => {
          const value = e.currentTarget.value
          if (value.trim() && focusReady.current) return onDone(value)
          window.setTimeout(() => {
            const editor = ref.current
            if (editor && !editor.value.trim() && document.activeElement !== editor) onDone('')
          }, 350)
        }}
      />
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
  const focusReady = useRef(false)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus()
      if (initial) ref.current?.setSelectionRange(initial.length, initial.length)
      focusReady.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initial])

  // Notes intentionally keep their markdown-backed rich formatting. Canvas
  // text uses CanvasTextEditor above and never enters this code path.
  const sel = useRef({ start: 0, end: 0 })
  const remember = () => {
    const textarea = ref.current
    if (textarea) sel.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  const wrap = (before: string, after = before) => {
    const textarea = ref.current
    if (!textarea) return
    const { start, end } = sel.current
    const picked = textarea.value.slice(start, end) || 'text'
    textarea.setRangeText(before + picked + after, start, end)
    const from = start + before.length
    textarea.focus()
    textarea.setSelectionRange(from, from + picked.length)
    remember()
  }
  const linePrefix = (prefix: string) => {
    const textarea = ref.current
    if (!textarea) return
    const { start } = sel.current
    const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1
    const existing = textarea.value.slice(lineStart).match(/^(#{1,3} |- \[[ x]\] |- )/)
    let caret = start
    if (existing) {
      textarea.setRangeText('', lineStart, lineStart + existing[0].length)
      caret -= existing[0].length
      if (existing[0] === prefix) {
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
        remember()
        return
      }
    }
    textarea.setRangeText(prefix, lineStart, lineStart)
    textarea.focus()
    textarea.setSelectionRange(caret + prefix.length, caret + prefix.length)
    remember()
  }
  const tools: Array<[string, string, () => void]> = [
    ['B', 'bold', () => wrap('**')],
    ['I', 'italic', () => wrap('*')],
    ['H', 'heading', () => linePrefix('# ')],
    ['•', 'bullet list', () => linePrefix('- ')],
    ['☑', 'task', () => linePrefix('- [ ] ')],
    ['<>', 'code', () => wrap('`')],
    ['↗', 'link', () => wrap('[', '](url)')],
  ]

  return (
    <div className="note-editor" style={{ left: at.x, top: at.y }}>
      <div className="note-tools" onPointerDown={(e) => e.preventDefault()}>
        {tools.map(([label, title, action]) => (
          <button key={title} title={title} onClick={action}>{label}</button>
        ))}
      </div>
      <textarea
        ref={ref}
        defaultValue={initial}
        placeholder={'write, then Enter\nshift+Enter for a new line'}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey
          if (mod && e.key.toLowerCase() === 'b') {
            e.preventDefault()
            wrap('**')
            return
          }
          if (mod && e.key.toLowerCase() === 'i') {
            e.preventDefault()
            wrap('*')
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onDone(e.currentTarget.value)
          }
          if (e.key === 'Escape') onDone(initial ?? '')
        }}
        onBlur={(e) => {
          const value = e.currentTarget.value
          if (value.trim() && focusReady.current) return onDone(value)
          window.setTimeout(() => {
            const editor = ref.current
            if (editor && !editor.value.trim() && document.activeElement !== editor) onDone('')
          }, 350)
        }}
      />
    </div>
  )
}
