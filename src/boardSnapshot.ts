import type { Annotation, Card, Link, Stroke, XY } from './types'
import { cardDims } from './embed/dims'
import { documentSnapshot } from './docCanvas'

export interface BoardSnapshotInput {
  boardName?: string
  cards: Record<string, Card>
  positions: Record<string, XY>
  links: Record<string, Link>
  strokes: Stroke[]
  annotations?: Annotation[]
}

const esc = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const lines = (text: string, chars: number, limit: number): string[] => {
  const result: string[] = []
  for (const paragraph of text.replace(/<[^>]+>/g, ' ').split(/\n+/)) {
    let rest = paragraph.trim()
    while (rest && result.length < limit) {
      if (rest.length <= chars) {
        result.push(rest)
        break
      }
      let cut = rest.lastIndexOf(' ', chars)
      if (cut < chars / 2) cut = chars
      result.push(rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
    }
    if (result.length >= limit) break
  }
  return result
}

function strokeBounds(stroke: Stroke): XY[] {
  if (stroke.kind !== 'text' || !stroke.points[0]) return stroke.points
  const at = stroke.points[0]
  const size = stroke.fontSize ?? 18
  const rows = (stroke.text ?? '').split('\n')
  return [at, {
    x: at.x + Math.max(1, ...rows.map((row) => row.length)) * size * 0.62,
    y: at.y + Math.max(1, rows.length) * size * 1.3,
  }]
}

function strokeSvg(stroke: Stroke): string {
  if (!stroke.points[0]) return ''
  const a = stroke.points[0]
  const b = stroke.points[stroke.points.length - 1]
  if (stroke.kind === 'text') {
    const size = stroke.fontSize ?? 18
    return (stroke.text ?? '').split('\n').map((row, index) =>
      `<text x="${a.x}" y="${a.y + size + index * size * 1.3}" font-size="${size}" class="draw-text">${esc(row)}</text>`,
    ).join('')
  }
  if (!b || stroke.points.length < 2) return ''
  if (stroke.kind === 'rect') return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" rx="6"/>`
  if (stroke.kind === 'ellipse') return `<ellipse cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" rx="${Math.abs(b.x - a.x) / 2}" ry="${Math.abs(b.y - a.y) / 2}"/>`
  if (stroke.kind === 'line') return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`
  if (stroke.kind === 'arrow') {
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const size = 13
    const h1 = `${b.x - size * Math.cos(angle - Math.PI / 6)},${b.y - size * Math.sin(angle - Math.PI / 6)}`
    const h2 = `${b.x - size * Math.cos(angle + Math.PI / 6)},${b.y - size * Math.sin(angle + Math.PI / 6)}`
    return `<polyline points="${a.x},${a.y} ${b.x},${b.y} ${h1} ${b.x},${b.y} ${h2}"/>`
  }
  return `<polyline points="${stroke.points.slice(0, 1500).map((point) => `${point.x},${point.y}`).join(' ')}"/>`
}

function cardSvg(card: Card, at: XY): string {
  const { w, h } = cardDims(card)
  const x = at.x - w / 2
  const y = at.y - h / 2
  const title = card.title ?? (card.type === 'text' ? '' : card.type)
  const heading = title ? `<text x="${x + 12}" y="${y + 22}" class="card-title">${esc(title)}</text>` : ''
  if (card.type === 'canvas' && card.document) {
    const image = card.document.snapshot || documentSnapshot(card.document)
    return `<g><rect class="card" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${heading}` +
      `${image ? `<image href="${esc(image)}" x="${x + 8}" y="${y + 30}" width="${w - 16}" height="${h - 38}" preserveAspectRatio="none"/>` : ''}</g>`
  }
  if ((card.type === 'image' || card.type === 'sketch') && /^(data:image\/|https?:\/\/)/.test(card.content)) {
    return `<g><rect class="card" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${heading}` +
      `<image href="${esc(card.content)}" x="${x + 8}" y="${y + (title ? 30 : 8)}" width="${w - 16}" height="${h - (title ? 38 : 16)}" preserveAspectRatio="xMidYMid meet"/></g>`
  }
  const body = card.type === 'widget'
    ? (card.meta?.description ?? 'Interactive widget')
    : card.content
  const bodyLines = lines(body, Math.max(12, Math.floor((w - 24) / 7)), Math.max(2, Math.floor((h - 38) / 18)))
  const text = bodyLines.map((line, index) =>
    `<text x="${x + 12}" y="${y + (title ? 43 : 23) + index * 18}" class="card-copy">${esc(line)}</text>`,
  ).join('')
  return `<g><rect class="card" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${heading}${text}</g>`
}

/** A visual whole-board export. Geometry stays internal; callers get one image. */
export function boardSnapshot(input: BoardSnapshotInput): string {
  const cards = Object.values(input.cards).filter((card) => !card.mergedInto && input.positions[card.id])
  const extents: XY[] = []
  for (const card of cards) {
    const at = input.positions[card.id]
    const { w, h } = cardDims(card)
    extents.push({ x: at.x - w / 2, y: at.y - h / 2 }, { x: at.x + w / 2, y: at.y + h / 2 })
  }
  for (const stroke of input.strokes) extents.push(...strokeBounds(stroke))
  if (!extents.length) extents.push({ x: -320, y: -210 }, { x: 320, y: 210 })
  const pad = 80
  const minX = Math.min(...extents.map((point) => point.x)) - pad
  const minY = Math.min(...extents.map((point) => point.y)) - pad
  const width = Math.max(320, Math.max(...extents.map((point) => point.x)) - minX + pad)
  const height = Math.max(240, Math.max(...extents.map((point) => point.y)) - minY + pad)
  const scale = Math.min(1, 2400 / width, 2400 / height)
  const outputWidth = Math.max(1, Math.round(width * scale))
  const outputHeight = Math.max(1, Math.round(height * scale))

  const links = Object.values(input.links).map((link) => {
    const a = input.positions[link.from]
    const b = input.positions[link.to]
    if (!a || !b) return ''
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
    return `<path class="link" d="M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}"/>`
  }).join('')
  const annotations = (input.annotations ?? []).map((annotation) => {
    const members = annotation.cardIds.map((id) => {
      const card = input.cards[id]
      const at = input.positions[id]
      if (!card || !at) return null
      return { at, ...cardDims(card) }
    }).filter((value): value is { at: XY; w: number; h: number } => Boolean(value))
    if (!members.length) return ''
    const x1 = Math.min(...members.map((member) => member.at.x - member.w / 2)) - 22
    const y1 = Math.min(...members.map((member) => member.at.y - member.h / 2)) - 22
    const x2 = Math.max(...members.map((member) => member.at.x + member.w / 2)) + 22
    const y2 = Math.max(...members.map((member) => member.at.y + member.h / 2)) + 22
    return annotation.kind === 'circle'
      ? `<ellipse class="annotation" cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${(x2 - x1) / 2}" ry="${(y2 - y1) / 2}"/>`
      : `<rect class="annotation" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="18"/>`
  }).join('')
  const cardMarkup = cards.map((card) => cardSvg(card, input.positions[card.id])).join('')
  const drawings = input.strokes.map(strokeSvg).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="${minX} ${minY} ${width} ${height}">` +
    `<style>.bg{fill:#11171b}.card{fill:#192126;stroke:#536068;stroke-width:1}.card-title{fill:#f1eadc;font:600 13px system-ui,sans-serif}.card-copy{fill:#d9d2c5;font:13px system-ui,sans-serif}.link{fill:none;stroke:#71818b;stroke-width:2}.drawing polyline,.drawing path,.drawing line,.drawing rect,.drawing ellipse{fill:none;stroke:#8aa5ff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.draw-text{fill:#f1eadc;stroke:none;font-family:'Segoe Print','Bradley Hand','Comic Sans MS',cursive}.annotation{fill:none;stroke:#9a86ff;stroke-width:2;stroke-dasharray:8 5}</style>` +
    `<rect class="bg" x="${minX}" y="${minY}" width="${width}" height="${height}"/>` +
    `<text x="${minX + 24}" y="${minY + 34}" class="card-title">${esc(input.boardName || 'Mundaneum board')}</text>` +
    `<g>${links}</g><g>${annotations}</g>${cardMarkup}<g class="drawing">${drawings}</g></svg>`
}

export function boardImageContent(input: BoardSnapshotInput): { data: string; mimeType: string } {
  const bytes = new TextEncoder().encode(boardSnapshot(input))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { data: btoa(binary), mimeType: 'image/svg+xml' }
}

export function boardImageDataUrl(input: BoardSnapshotInput): string {
  const image = boardImageContent(input)
  return `data:${image.mimeType};base64,${image.data}`
}

/** Rasterize the complete board image in the open page for image-native MCP clients. */
export async function boardPngContent(input: BoardSnapshotInput): Promise<{ data: string; mimeType: 'image/png' }> {
  const svg = boardSnapshot(input)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const source = new Image()
    source.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve()
      source.onerror = () => reject(new Error('Could not render the whole-board image.'))
      source.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = source.naturalWidth
    canvas.height = source.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PNG rendering is unavailable in this browser.')
    context.drawImage(source, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/png' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function boardPngDataUrl(input: BoardSnapshotInput): Promise<string> {
  const image = await boardPngContent(input)
  return `data:${image.mimeType};base64,${image.data}`
}
