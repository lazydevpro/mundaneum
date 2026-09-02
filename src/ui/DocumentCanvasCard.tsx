import { useEffect, useRef, useState } from 'react'
import type { Card, DocumentStroke, DocumentText, XY } from '../types'
import { useBoard } from '../store'
import { renderDocumentPng } from '../docCanvas'
import { strokePath, useInk, type PenTool } from './ink'
import { isDirectDisplayPen, pointerSamples } from './pointer'

const distanceToSegment = (p: XY, a: XY, b: XY): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

const outline = (stroke: DocumentStroke): XY[] => {
  const points = stroke.points
  if (points.length < 2 || (stroke.kind ?? 'draw') === 'draw') return points
  const a = points[0]
  const b = points[points.length - 1]
  if (stroke.kind === 'ellipse') {
    return Array.from({ length: 33 }, (_, i) => {
      const angle = (i / 32) * Math.PI * 2
      return {
        x: (a.x + b.x) / 2 + Math.cos(angle) * Math.abs(b.x - a.x) / 2,
        y: (a.y + b.y) / 2 + Math.sin(angle) * Math.abs(b.y - a.y) / 2,
      }
    })
  }
  if (stroke.kind === 'rect') return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]
  return [a, b]
}

export function DocumentCanvasCard({ card }: { card: Card }) {
  const [active, setActive] = useState<{ kind: Exclude<PenTool, 'erase' | 'text' | 'select'>; points: XY[] } | null>(null)
  const [selectedStrokes, setSelectedStrokes] = useState<string[]>([])
  const [editingText, setEditingText] = useState<string | null>(null)
  const paper = useRef<HTMLDivElement>(null)
  const textPlacedAt = useRef<Record<string, number>>({})
  const moving = useRef<{
    pointerId: number
    start: XY
    ids: string[]
    original: Map<string, XY[]>
  } | null>(null)
  const activePointer = useRef<number | null>(null)
  const pointerTool = useRef<PenTool | null>(null)
  const resizing = useRef<{ pointerId: number; x: number; y: number; width: number; height: number; scale: number } | null>(null)
  const pen = useInk((s) => s.pen)
  const tool = useInk((s) => s.tool)
  const documentId = useInk((s) => s.documentId)
  const drawingHere = pen && documentId === card.id
  const doc = card.document ?? { text: card.content, strokes: [] }
  const canvasWidth = doc.canvasWidth ?? 320
  const canvasHeight = doc.canvasHeight ?? 240

  useEffect(() => {
    if (!card.document) useBoard.getState().updateCard(card.id, { document: doc })
  }, [card.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const snapshot = renderDocumentPng(doc)
      const current = useBoard.getState().cards[card.id]
      if (!snapshot || !current?.document || current.document.snapshot === snapshot) return
      useBoard.getState().updateCard(card.id, { document: { ...current.document, snapshot } })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [card.id, doc.text, doc.strokes, doc.width, doc.height, doc.canvasWidth, doc.canvasHeight])

  useEffect(() => () => {
    if (useInk.getState().documentId === card.id) useInk.getState().setPen(false)
  }, [card.id])

  useEffect(() => {
    if (!editingText) return
    const frame = window.requestAnimationFrame(() => {
      paper.current?.querySelector<HTMLTextAreaElement>(`[data-document-text-id="${editingText}"]`)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editingText])

  const save = (text: string, strokes: DocumentStroke[], size?: Partial<Pick<typeof doc, 'width' | 'height' | 'canvasWidth' | 'canvasHeight'>>) => {
    useBoard.getState().updateCard(card.id, { content: text, document: { ...doc, text, strokes, ...size } })
  }

  const saveTextItems = (textItems: DocumentText[]) => {
    useBoard.getState().updateCard(card.id, { document: { ...doc, textItems } })
  }

  const deleteTextItem = (id: string) => {
    const current = useBoard.getState().cards[card.id]?.document
    if (!current) return
    useBoard.getState().updateCard(card.id, {
      document: { ...current, textItems: (current.textItems ?? []).filter((item) => item.id !== id) },
    })
  }

  const placeText = (p: XY) => {
    const item: DocumentText = {
      id: 'dt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: '', x: p.x, y: p.y, fontSize: 16,
    }
    textPlacedAt.current[item.id] = Date.now()
    saveTextItems([...(doc.textItems ?? []), item])
    setEditingText(item.id)
  }

  const point = (e: { clientX: number; clientY: number; pressure?: number }, includePressure = false): XY => {
    const r = paper.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvasWidth, ((e.clientX - r.left) / r.width) * canvasWidth)),
      y: Math.max(0, Math.min(canvasHeight, ((e.clientY - r.top) / r.height) * canvasHeight)),
      ...(includePressure ? { pressure: e.pressure ?? 0.5 } : {}),
    }
  }

  const eraseAt = (p: XY) => {
    const gone = new Set<string>()
    for (const stroke of doc.strokes) {
      const points = outline(stroke)
      for (let i = 0; i < points.length - 1; i++) {
        if (distanceToSegment(p, points[i], points[i + 1]) < 9) {
          gone.add(stroke.id)
          break
        }
      }
    }
    if (gone.size) save(doc.text, doc.strokes.filter((stroke) => !gone.has(stroke.id)))
  }

  const hitStroke = (p: XY): string | null => {
    for (const stroke of [...doc.strokes].reverse()) {
      const points = outline(stroke)
      for (let i = 0; i < points.length - 1; i++) {
        if (distanceToSegment(p, points[i], points[i + 1]) < 10) return stroke.id
      }
    }
    return null
  }

  const moveSelectedStrokes = (p: XY) => {
    const drag = moving.current
    if (!drag) return
    const dx = p.x - drag.start.x
    const dy = p.y - drag.start.y
    const current = useBoard.getState().cards[card.id]
    const currentDocument = current?.document
    if (!currentDocument) return
    const selected = new Set(drag.ids)
    useBoard.getState().updateCard(card.id, {
      document: {
        ...currentDocument,
        strokes: currentDocument.strokes.map((stroke) => {
          if (!selected.has(stroke.id)) return stroke
          const original = drag.original.get(stroke.id) ?? stroke.points
          return { ...stroke, points: original.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
        }),
      },
    })
  }

  const activateDrawing = () => {
    useInk.getState().setDocument(card.id)
  }

  const saveText = (text: string, target: HTMLTextAreaElement) => {
    // A document grows with its writing. Ink is in the same local coordinate
    // space, so marks don't move or get separated into a different section.
    const desiredHeight = Math.max(doc.height ?? 270, target.scrollHeight + 2)
    const previousHeight = doc.height ?? 270
    save(text, doc.strokes, desiredHeight === previousHeight ? undefined : {
      height: desiredHeight,
      canvasHeight: canvasHeight + (desiredHeight - previousHeight),
    })
  }

  return (
    <div className="document-canvas">
      <div className="document-canvas-head">
        <input value={card.title ?? ''} aria-label="Document title" placeholder="Untitled document"
          onPointerDown={(e) => { if (!e.shiftKey) e.stopPropagation() }}
          onChange={(e) => useBoard.getState().updateCard(card.id, { title: e.target.value })} />
        <div className="document-canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button className={!drawingHere ? 'active' : ''} aria-label="Write text in document" title="type text"
            onClick={() => {
              if (useInk.getState().documentId === card.id) useInk.getState().setPen(false)
            }}>T</button>
          <button className={drawingHere ? 'active' : ''} aria-label="Draw in document with board tools"
            title="draw with the board pen tools" onClick={activateDrawing}>✎</button>
        </div>
      </div>
      <div ref={paper} className={'document-paper ' + (drawingHere ? (tool === 'select' ? 'mode-select' : 'mode-draw') : 'mode-write')}
        style={{ height: doc.height ?? 270 }}
        onPointerDown={(e) => {
          const pencil = e.pointerType === 'pen'
          if (isDirectDisplayPen(e.nativeEvent)) {
            // Discard a palm interaction already in progress before the pen
            // takes ownership of this document, as tldraw does on tablets.
            moving.current = null
            activePointer.current = null
            setActive(null)
            useInk.getState().setPenMode(true)
            window.dispatchEvent(new Event('mundaneum:stylus-start'))
            if (e.cancelable) e.preventDefault()
          } else if (useInk.getState().penMode && !pencil) {
            return
          }
          if (pencil && !drawingHere) activateDrawing()
          if (!drawingHere && !pencil) return
          e.stopPropagation()
          try { paper.current?.setPointerCapture(e.pointerId) } catch { /* WebKit may refuse capture. */ }
          activePointer.current = e.pointerId
          const p = point(e, pencil)
          const currentTool = pencil && e.button === 5 ? 'erase' : useInk.getState().tool
          pointerTool.current = currentTool
          if (currentTool === 'select') {
            const hit = (e.target as Element).closest?.('[data-document-stroke]')?.getAttribute('data-document-stroke') ?? hitStroke(p)
            if (!hit) {
              if (!e.shiftKey) setSelectedStrokes([])
              return
            }
            const ids = e.shiftKey
              ? (selectedStrokes.includes(hit)
                  ? selectedStrokes.filter((id) => id !== hit)
                  : [...selectedStrokes, hit])
              : (selectedStrokes.includes(hit) ? selectedStrokes : [hit])
            setSelectedStrokes(ids)
            if (!ids.includes(hit)) return
            moving.current = {
              pointerId: e.pointerId,
              start: p,
              ids,
              original: new Map(doc.strokes.filter((stroke) => ids.includes(stroke.id)).map((stroke) => [stroke.id, stroke.points.map((point) => ({ ...point }))])),
            }
          } else if (currentTool === 'text') {
            activePointer.current = null
            placeText(p)
          }
          else if (currentTool === 'erase') eraseAt(p)
          else setActive({ kind: currentTool, points: [p] })
        }}
        onPointerMove={(e) => {
          if (useInk.getState().penMode && e.pointerType !== 'pen') return
          const drawingActive = useInk.getState().pen && useInk.getState().documentId === card.id
          if (activePointer.current !== e.pointerId || !(e.buttons & 1) || !drawingActive) return
          if (e.pointerType === 'pen' && e.cancelable) e.preventDefault()
          const samples = pointerSamples(e.nativeEvent)
          const points = samples.map((sample) => point(sample, e.pointerType === 'pen'))
          const p = points[points.length - 1]
          const currentTool = pointerTool.current ?? tool
          if (currentTool === 'select') moveSelectedStrokes(p)
          else if (currentTool === 'erase') points.forEach(eraseAt)
          else setActive((stroke) => stroke
            ? { ...stroke, points: stroke.kind === 'draw' ? [...stroke.points, ...points] : [stroke.points[0], p] }
            : stroke)
        }}
        onPointerUp={(e) => {
          if (activePointer.current !== e.pointerId) return
          if (e.pointerType === 'pen' && e.cancelable) e.preventDefault()
          try { if (paper.current?.hasPointerCapture(e.pointerId)) paper.current.releasePointerCapture(e.pointerId) } catch { /* already released */ }
          if (active && active.points.length > 1) {
            save(doc.text, [...doc.strokes, {
              id: 'ds' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              kind: active.kind, points: active.points,
            }])
          }
          activePointer.current = null
          pointerTool.current = null
          moving.current = null
          setActive(null)
        }}
        onPointerCancel={(e) => {
          if (activePointer.current !== e.pointerId) return
          try { if (paper.current?.hasPointerCapture(e.pointerId)) paper.current.releasePointerCapture(e.pointerId) } catch { /* already released */ }
          activePointer.current = null
          pointerTool.current = null
          moving.current = null
          setActive(null)
        }}>
        <textarea value={doc.text} aria-label="Document text"
          placeholder={drawingHere ? '' : 'Type notes, or use the document pen for handwriting and equations…'}
          onPointerDown={(e) => { if (!e.shiftKey) e.stopPropagation() }}
          onChange={(e) => saveText(e.target.value, e.currentTarget)} />
        {(doc.textItems ?? []).map((item) => (
          <div key={item.id} className="document-floating-text-wrap"
            style={{ left: `${(item.x / canvasWidth) * 100}%`, top: `${(item.y / canvasHeight) * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}>
            <textarea className="document-floating-text" value={item.text} aria-label="Document floating text"
              data-document-text-id={item.id}
              autoFocus={editingText === item.id}
              rows={Math.max(1, item.text.split('\n').length)}
              style={{ fontSize: item.fontSize ?? 16 }}
              onFocus={() => setEditingText(item.id)}
              onBlur={(e) => {
                // Browsers can emit a blur while an auto-focused textarea is
                // first mounted. Give a newly placed item time to receive the
                // user's keystroke before applying the empty-item cleanup.
                if (!e.currentTarget.value.trim() && Date.now() - (textPlacedAt.current[item.id] ?? 0) > 500) {
                  deleteTextItem(item.id)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  if (!e.currentTarget.value.trim()) {
                    deleteTextItem(item.id)
                  }
                  setEditingText(null)
                  e.currentTarget.blur()
                }
              }}
              onChange={(e) => saveTextItems((doc.textItems ?? []).map((candidate) => candidate.id === item.id ? { ...candidate, text: e.target.value } : candidate))} />
          </div>
        ))}
        <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-label="Document drawing layer">
          {doc.strokes.map((stroke) => <g key={stroke.id} data-document-stroke={stroke.id} className={selectedStrokes.includes(stroke.id) ? 'picked' : undefined}>{strokePath({ kind: stroke.kind ?? 'draw', points: stroke.points })}</g>)}
          {active && <g className="live">{strokePath(active)}</g>}
        </svg>
      </div>
      <button className="document-resize" aria-label="Resize document canvas"
        title="Drag to expand the document and drawing space"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          const renderedWidth = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 360
          resizing.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY,
            width: doc.width ?? 360, height: doc.height ?? 270, scale: renderedWidth / (doc.width ?? 360) }
        }}
        onPointerMove={(e) => {
          const start = resizing.current
          if (!start || start.pointerId !== e.pointerId) return
          const width = Math.max(300, start.width + (e.clientX - start.x) / start.scale)
          const height = Math.max(220, start.height + (e.clientY - start.y) / start.scale)
          save(doc.text, doc.strokes, { width, height,
            canvasWidth: canvasWidth + (width - (doc.width ?? 360)),
            canvasHeight: canvasHeight + (height - (doc.height ?? 270)) })
        }}
        onPointerUp={() => { resizing.current = null }} onPointerCancel={() => { resizing.current = null }} />
    </div>
  )
}
