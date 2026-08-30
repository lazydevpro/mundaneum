import type { Arrangement, Card, XY } from '../types'
import { cardDims } from '../embed/dims'

/**
 * Non-cluster arrangements: masonry (the WordPress tiled-gallery look), a
 * uniform grid, one row, one column. Still page-owned geometry — an agent
 * changed nothing here; the human just picked a different projection.
 * Cards are ordered by semantic community (when known) then by age, so
 * meaning survives as adjacency even in a wall layout.
 */

const GUT = 26

export function arrangePositions(
  cards: Card[],
  mode: Exclude<Arrangement, 'clusters'>,
  communityOf: (id: string) => number | undefined,
): Record<string, XY> {
  const ordered = [...cards].sort((a, b) => {
    const ca = communityOf(a.id) ?? 1e9
    const cb = communityOf(b.id) ?? 1e9
    if (ca !== cb) return ca - cb
    return a.addedAt - b.addedAt
  })
  const dims = ordered.map((c) => cardDims(c))
  const positions: Record<string, XY> = {}

  if (mode === 'masonry') {
    const colW = 320 + GUT
    const sumH = dims.reduce((a, d) => a + d.h + GUT, 0)
    const cols = Math.max(2, Math.min(10, Math.round(Math.sqrt((1.7 * sumH) / colW))))
    const heights = new Array<number>(cols).fill(0)
    ordered.forEach((c, i) => {
      const col = heights.indexOf(Math.min(...heights))
      positions[c.id] = {
        x: col * colW + colW / 2,
        y: heights[col] + dims[i].h / 2,
      }
      heights[col] += dims[i].h + GUT
    })
    return center(positions)
  }

  if (mode === 'grid') {
    const cell = 320 + GUT
    const rowH = 280
    const cols = Math.max(2, Math.ceil(Math.sqrt(ordered.length * 1.5)))
    ordered.forEach((c, i) => {
      positions[c.id] = {
        x: (i % cols) * cell,
        y: Math.floor(i / cols) * rowH,
      }
    })
    return center(positions)
  }

  if (mode === 'row') {
    let x = 0
    ordered.forEach((c, i) => {
      positions[c.id] = { x: x + dims[i].w / 2, y: 0 }
      x += dims[i].w + GUT
    })
    return center(positions)
  }

  // column — one card per line, a reading list
  let y = 0
  ordered.forEach((c, i) => {
    positions[c.id] = { x: 0, y: y + dims[i].h / 2 }
    y += dims[i].h + GUT
  })
  return center(positions)
}

function center(positions: Record<string, XY>): Record<string, XY> {
  const pts = Object.values(positions)
  if (!pts.length) return positions
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2
  for (const p of pts) {
    p.x -= cx
    p.y -= cy
  }
  return positions
}
