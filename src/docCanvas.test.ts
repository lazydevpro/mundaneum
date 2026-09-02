import { describe, expect, it } from 'vitest'
import {
  canvasDocumentForAgent, documentImageContent, documentSnapshot, documentSnapshotBase64,
  drawingSelectionImageContent,
} from './docCanvas'
import type { Card, CanvasDocument } from './types'
import { callBoardTool } from '../worker/mcp'
import type { SyncDoc } from './sync/doc'

const document: CanvasDocument = {
  text: 'x² + 5x + 6 = 0 & solve',
  strokes: [{ id: 's1', kind: 'draw', points: [{ x: 1, y: 2 }, { x: 20, y: 30 }] }],
}

describe('document canvas agent representation', () => {
  it('keeps typed text and handwriting in one visual snapshot', () => {
    const snapshot = decodeURIComponent(documentSnapshot(document)!)
    expect(snapshot).toContain('x² + 5x + 6 = 0 &amp; solve')
    expect(snapshot).toContain('<polyline points="1,2 20,30"/>')
    expect(documentSnapshotBase64(document)).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('renders board-quality shapes in an expanding document space', () => {
    const snapshot = decodeURIComponent(documentSnapshot({
      text: '', canvasWidth: 600, canvasHeight: 420,
      strokes: [
        { id: 'box', kind: 'rect', points: [{ x: 330, y: 260 }, { x: 580, y: 400 }] },
        { id: 'oval', kind: 'ellipse', points: [{ x: 20, y: 30 }, { x: 120, y: 90 }] },
      ],
    })!)
    expect(snapshot).toContain('viewBox="0 0 600 420"')
    expect(snapshot).toContain('<rect x="330" y="260" width="250" height="140" rx="6"/>')
    expect(snapshot).toContain('<ellipse cx="70" cy="60" rx="50" ry="30"/>')
  })

  it('keeps all typed lines in an unbounded document image', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    const snapshot = decodeURIComponent(documentSnapshot({ text: longText, strokes: [], height: 900 })!)
    expect(snapshot).toContain('line 1')
    expect(snapshot).toContain('line 30')
    expect(snapshot).toContain('height="1800"')
  })

  it('exposes searchable text and an image without raw stroke coordinates', () => {
    const card = {
      id: 'c1', type: 'canvas', content: document.text, document,
      addedBy: 'human', addedAt: 1, accepted: true,
    } satisfies Card
    const result = canvasDocumentForAgent(card)!
    expect(result.typed_text).toBe(document.text)
    expect(result.handwriting_image_tool).toEqual({ name: 'get_canvas_document', card_id: 'c1' })
    expect(result).not.toHaveProperty('strokes')
  })

  it('prefers the cached PNG for native multimodal results', () => {
    expect(documentImageContent({ ...document, snapshot: 'data:image/png;base64,cG5n' })).toEqual({
      data: 'cG5n',
      mimeType: 'image/png',
    })
  })

  it('bundles selected board strokes into one cropped image', () => {
    const image = drawingSelectionImageContent([
      { id: 'a', kind: 'line', points: [{ x: 100, y: 200 }, { x: 150, y: 250 }] },
      { id: 'b', kind: 'rect', points: [{ x: 170, y: 190 }, { x: 230, y: 260 }] },
    ])
    expect(image?.mimeType).toBe('image/svg+xml')
    expect(image?.data).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(atob(image!.data)).toContain('viewBox="82 172 166 106"')
  })

  it('keeps positioned canvas text inside the selected drawing image', () => {
    const image = drawingSelectionImageContent([
      { id: 'label', kind: 'text', points: [{ x: 40, y: 50 }], text: 'handwritten label', fontSize: 18 },
    ])
    const svg = atob(image!.data)
    expect(svg).toContain('handwritten label')
    expect(svg).toContain('font-size="18"')
    expect(svg).toContain('Segoe Print')
  })

  it('returns native image content from the classic MCP tool too', () => {
    const card = {
      id: 'c1', type: 'canvas', content: document.text,
      document: { ...document, snapshot: 'data:image/png;base64,cG5n' },
      addedBy: 'human', addedAt: 1, accepted: true,
    } satisfies Card
    const doc = {
      v: 1, boardName: 'test', updatedAt: 1, cards: { c1: card }, links: {}, positions: {},
      labels: [], strokes: [], annotations: [], deleted: {},
      prefs: { theme: 'mint', style: 'pure', arrangement: 'clusters' },
    } satisfies SyncDoc
    const result = callBoardTool(doc, 'get_canvas_document', { card_id: 'c1' })
    expect(result.content?.map((block) => block.type)).toEqual(['text', 'image'])
    expect(result.content?.[1]).toMatchObject({ mimeType: 'image/png', data: 'cG5n' })
  })
})
