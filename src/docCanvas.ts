import type { Card, CanvasDocument, Stroke } from './types'

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function wrappedLines(text: string, width = 54): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let rest = paragraph
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width)
      if (cut < width / 2) cut = width
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut).trimStart()
    }
    lines.push(rest)
  }
  return lines
}

export function renderDocumentPng(document: CanvasDocument): string | null {
  if (typeof window === 'undefined') return null
  const documentWidth = Math.max(300, document.width ?? 360)
  const documentHeight = Math.max(220, document.height ?? 270)
  // The page itself has no maximum size. Raster exports scale down only to
  // keep a pathological document from allocating an impractically huge image.
  const exportScale = Math.min(2, 2048 / Math.max(documentWidth, documentHeight))
  const width = Math.round(documentWidth * exportScale)
  const height = Math.round(documentHeight * exportScale)
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#fffdf7'
  g.fillRect(0, 0, width, height)
  g.fillStyle = '#262724'
  const textScale = width / documentWidth
  const spaceWidth = document.canvasWidth ?? 320
  const spaceHeight = document.canvasHeight ?? 240
  const sx = width / spaceWidth
  const sy = height / spaceHeight
  g.font = `${13 * textScale}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`
  const lineHeight = 24 * textScale
  wrappedLines(document.text, Math.max(20, Math.floor(documentWidth / 6.7)))
    .forEach((line, i) => g.fillText(line, 12 * textScale, lineHeight * (i + 0.78)))
  for (const item of document.textItems ?? []) {
    const itemScale = width / documentWidth
    g.font = `${item.italic ? 'italic ' : ''}${item.bold ? '700 ' : ''}${(item.fontSize ?? 16) * itemScale}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`
    g.fillStyle = item.color ?? '#262724'
    const lines = item.text.split('\n')
    lines.forEach((line, i) => g.fillText(line, item.x * sx, (item.y + i * (item.fontSize ?? 16) * 1.25) * sy))
  }
  g.strokeStyle = '#262724'
  g.lineWidth = Math.max(1.5, 2 * textScale)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const stroke of document.strokes.slice(-300)) {
    if (stroke.points.length < 2) continue
    const kind = stroke.kind ?? 'draw'
    const a = stroke.points[0]
    const b = stroke.points[stroke.points.length - 1]
    g.beginPath()
    if (kind === 'rect') {
      g.roundRect(Math.min(a.x, b.x) * sx, Math.min(a.y, b.y) * sy,
        Math.abs(b.x - a.x) * sx, Math.abs(b.y - a.y) * sy, 10)
    } else if (kind === 'ellipse') {
      g.ellipse((a.x + b.x) / 2 * sx, (a.y + b.y) / 2 * sy,
        Math.abs(b.x - a.x) / 2 * sx, Math.abs(b.y - a.y) / 2 * sy, 0, 0, Math.PI * 2)
    } else {
      g.moveTo(a.x * sx, a.y * sy)
      for (const p of stroke.points.slice(1, 1000)) g.lineTo(p.x * sx, p.y * sy)
      if (kind === 'arrow') {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const angle = Math.atan2(dy, dx)
        const size = 13
        g.moveTo(b.x * sx, b.y * sy)
        g.lineTo((b.x - size * Math.cos(angle - Math.PI / 6)) * sx, (b.y - size * Math.sin(angle - Math.PI / 6)) * sy)
        g.moveTo(b.x * sx, b.y * sy)
        g.lineTo((b.x - size * Math.cos(angle + Math.PI / 6)) * sx, (b.y - size * Math.sin(angle + Math.PI / 6)) * sy)
      }
    }
    g.stroke()
  }
  return canvas.toDataURL('image/png')
}

/** A visual agent-readable rendering; raw pen coordinates never leave the card. */
export function documentSnapshot(document: CanvasDocument | undefined): string | null {
  if (!document) return null
  const spaceWidth = document.canvasWidth ?? 320
  const spaceHeight = document.canvasHeight ?? 240
  const documentWidth = Math.max(300, document.width ?? 360)
  const documentHeight = Math.max(220, document.height ?? 270)
  const width = Math.round(documentWidth * 2)
  const height = Math.round(documentHeight * 2)
  const textScale = spaceWidth / documentWidth
  const lines = wrappedLines(document.text, Math.max(20, Math.floor(documentWidth / 6.7)))
  const typed = lines
    .map((line, i) => `<text x="${12 * textScale}" y="${(18.7 + i * 24) * textScale}">${esc(line)}</text>`)
    .join('')
  const ink = document.strokes
    .slice(-300)
    .map((stroke) => {
      if (stroke.points.length < 2) return ''
      const clean = (p: { x: number; y: number }) => ({
        x: Math.max(0, Math.min(spaceWidth, p.x)), y: Math.max(0, Math.min(spaceHeight, p.y)),
      })
      const a = clean(stroke.points[0])
      const b = clean(stroke.points[stroke.points.length - 1])
      const kind = stroke.kind ?? 'draw'
      if (kind === 'rect') return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" rx="6"/>`
      if (kind === 'ellipse') return `<ellipse cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" rx="${Math.abs(b.x - a.x) / 2}" ry="${Math.abs(b.y - a.y) / 2}"/>`
      if (kind === 'line') return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`
      if (kind === 'arrow') {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const size = 13
        const h1 = `${b.x - size * Math.cos(angle - Math.PI / 6)},${b.y - size * Math.sin(angle - Math.PI / 6)}`
        const h2 = `${b.x - size * Math.cos(angle + Math.PI / 6)},${b.y - size * Math.sin(angle + Math.PI / 6)}`
        return `<polyline points="${a.x},${a.y} ${b.x},${b.y} ${h1} ${b.x},${b.y} ${h2}"/>`
      }
      const points = stroke.points.slice(0, 1000).map(clean).map((p) => `${p.x},${p.y}`).join(' ')
      return `<polyline points="${points}"/>`
    })
    .join('')
  const floatingText = (document.textItems ?? []).map((item) => {
    const fontSize = item.fontSize ?? 16
    const style = `${item.bold ? 'font-weight:700;' : ''}${item.italic ? 'font-style:italic;' : ''}${item.color ? `fill:${esc(item.color)};` : ''}`
    return item.text.split('\n').map((line, i) =>
      `<text x="${item.x}" y="${item.y + fontSize + i * fontSize * 1.25}" font-size="${fontSize}" style="${style}">${esc(line)}</text>`,
    ).join('')
  }).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${spaceWidth} ${spaceHeight}" preserveAspectRatio="none">` +
    `<rect width="${spaceWidth}" height="${spaceHeight}" fill="#fffdf7"/>` +
    `<g fill="#262724" font-family="'Segoe Print','Bradley Hand','Comic Sans MS',cursive" font-size="${13 * textScale}">${typed}</g>` +
    `<g fill="none" stroke="#262724" stroke-width="${2 * textScale}" stroke-linecap="round" stroke-linejoin="round">${ink}</g>` +
    `<g font-family="'Segoe Print','Bradley Hand','Comic Sans MS',cursive">${floatingText}</g>` +
    `</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function documentSnapshotBase64(document: CanvasDocument | undefined): string | null {
  const url = documentSnapshot(document)
  if (!url) return null
  const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1))
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function documentImageContent(
  document: CanvasDocument | undefined,
): { data: string; mimeType: string } | null {
  if (!document) return null
  const png = document.snapshot?.match(/^data:image\/png;base64,(.+)$/)
  if (png) return { data: png[1], mimeType: 'image/png' }
  const data = documentSnapshotBase64(document)
  return data ? { data, mimeType: 'image/svg+xml' } : null
}

/** Render only the board drawings the human selected, cropped as one image. */
export function drawingSelectionImageContent(
  strokes: Stroke[],
): { data: string; mimeType: string } | null {
  const drawable = strokes.filter((stroke) => stroke.kind === 'text' ? Boolean(stroke.points[0] && stroke.text) : stroke.points.length > 1)
  if (!drawable.length) return null
  const points = drawable.flatMap((stroke) => {
    if (stroke.kind !== 'text' || !stroke.points[0]) return stroke.points
    const at = stroke.points[0]
    const size = stroke.fontSize ?? 18
    const lines = (stroke.text ?? '').split('\n')
    return [at, {
      x: at.x + Math.max(1, ...lines.map((line) => line.length)) * size * 0.62,
      y: at.y + Math.max(1, lines.length) * size * 1.3,
    }]
  })
  const pad = 18
  const minX = Math.min(...points.map((p) => p.x)) - pad
  const minY = Math.min(...points.map((p) => p.y)) - pad
  const width = Math.max(40, Math.max(...points.map((p) => p.x)) - minX + pad)
  const height = Math.max(40, Math.max(...points.map((p) => p.y)) - minY + pad)
  const ink = drawable.map((stroke) => {
    const a = stroke.points[0]
    const b = stroke.points[stroke.points.length - 1]
    if (stroke.kind === 'text') {
      const size = stroke.fontSize ?? 18
      return (stroke.text ?? '').split('\n').map((line, index) =>
        `<text x="${a.x}" y="${a.y + size + index * size * 1.3}" font-size="${size}" font-family="'Segoe Print','Bradley Hand','Comic Sans MS',cursive" fill="#262724" stroke="none">${esc(line)}</text>`,
      ).join('')
    }
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
    return `<polyline points="${stroke.points.slice(0, 1000).map((p) => `${p.x},${p.y}`).join(' ')}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${minX} ${minY} ${width} ${height}"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fffdf7"/><g fill="none" stroke="#262724" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${ink}</g></svg>`
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { data: btoa(binary), mimeType: 'image/svg+xml' }
}

export function canvasDocumentForAgent(card: Card): Record<string, unknown> | undefined {
  if (card.type !== 'canvas') return undefined
  const document = card.document ?? { text: card.content, strokes: [] }
  return {
    typed_text: document.text,
    handwriting_image_tool: { name: 'get_canvas_document', card_id: card.id },
    note: 'Use get_canvas_document for the canonical visual image of handwriting and equations; typed_text is searchable.',
  }
}
