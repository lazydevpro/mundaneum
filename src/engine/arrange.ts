import type { Arrangement, Card, Link, XY } from '../types'
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
  links: Link[] = [],
): Record<string, XY> {
  if (mode === 'tree') return treeLayout(cards, links)
  const ordered = [...cards].sort((a, b) => {
    const ca = communityOf(a.id) ?? 1e9
    const cb = communityOf(b.id) ?? 1e9
    if (ca !== cb) return ca - cb
    return a.addedAt - b.addedAt
  })
  const dims = ordered.map((c) => cardDims(c))
  const positions: Record<string, XY> = {}

  if (mode === 'masonry') {
    // Keep every column wide enough for the largest card (documents and live
    // widgets are wider than the old 320px assumption).
    const colW = Math.max(320, ...dims.map((d) => d.w)) + GUT
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
    const cols = Math.max(2, Math.ceil(Math.sqrt(ordered.length * 1.5)))
    // Grid cells must follow the real card footprint. A fixed row height made
    // live widgets (and tall document canvases) overlap the next row.
    const colWidths = new Array<number>(cols).fill(0)
    const rowHeights = new Array<number>(Math.ceil(ordered.length / cols)).fill(0)
    ordered.forEach((_c, i) => {
      const d = dims[i]
      colWidths[i % cols] = Math.max(colWidths[i % cols], d.w)
      rowHeights[Math.floor(i / cols)] = Math.max(rowHeights[Math.floor(i / cols)], d.h)
    })
    const colX: number[] = []
    const rowY: number[] = []
    let x = 0
    for (const width of colWidths) {
      colX.push(x)
      x += width + GUT
    }
    let y = 0
    for (const height of rowHeights) {
      rowY.push(y)
      y += height + GUT
    }
    ordered.forEach((c, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      positions[c.id] = {
        // Cards are center-anchored by the canvas, so store cell centers.
        x: colX[col] + colWidths[col] / 2,
        y: rowY[row] + rowHeights[row] / 2,
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

/**
 * Tree: the DIRECTED link graph (drawn arrows + agent link_cards) becomes a
 * layered hierarchy — roots on top, children below, longest-path layering.
 * Cards outside the tree park in a quiet grid underneath.
 */
function treeLayout(cards: Card[], links: Link[]): Record<string, XY> {
  const ids = new Set(cards.map((c) => c.id))
  const dLinks = links.filter((l) => l.directed && ids.has(l.from) && ids.has(l.to))
  const inTree = new Set<string>()
  for (const l of dLinks) {
    inTree.add(l.from)
    inTree.add(l.to)
  }

  const depth = new Map<string, number>()
  for (const id of inTree) depth.set(id, 0)
  for (let pass = 0; pass < 16; pass++) {
    let changed = false
    for (const l of dLinks) {
      const d = (depth.get(l.from) ?? 0) + 1
      if (d > (depth.get(l.to) ?? 0) && d < 40) {
        depth.set(l.to, d)
        changed = true
      }
    }
    if (!changed) break
  }

  const byId = new Map(cards.map((c) => [c.id, c]))
  const layers = new Map<number, string[]>()
  for (const [id, d] of depth) {
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(id)
  }

  // Order children under their parents: sort each layer by mean parent x.
  const positions: Record<string, XY> = {}
  const parentsOf = new Map<string, string[]>()
  for (const l of dLinks) {
    if (!parentsOf.has(l.to)) parentsOf.set(l.to, [])
    parentsOf.get(l.to)!.push(l.from)
  }
  const orderedDepths = [...layers.keys()].sort((a, b) => a - b)
  const depthHeights = new Map<number, number>()
  for (const depth of orderedDepths) {
    depthHeights.set(depth, Math.max(...(layers.get(depth) ?? []).map((id) => cardDims(byId.get(id)!).h), 0) + GUT)
  }
  const depthY = new Map<number, number>()
  let depthOffset = 0
  for (const depth of orderedDepths) {
    depthY.set(depth, depthOffset)
    depthOffset += depthHeights.get(depth) ?? GUT
  }
  for (const d of orderedDepths) {
    const layer = layers.get(d)!
    if (d > 0) {
      layer.sort((x, y) => {
        const px = parentsOf.get(x)?.map((p) => positions[p]?.x ?? 0) ?? [0]
        const py = parentsOf.get(y)?.map((p) => positions[p]?.x ?? 0) ?? [0]
        return px.reduce((a2, b2) => a2 + b2, 0) / px.length - py.reduce((a2, b2) => a2 + b2, 0) / py.length
      })
    }
    const widths = layer.map((id) => cardDims(byId.get(id)!).w)
    const total = widths.reduce((a2, w) => a2 + w + GUT, -GUT)
    let x = -total / 2
    layer.forEach((id, i) => {
      positions[id] = { x: x + widths[i] / 2, y: (depthY.get(d) ?? 0) + (cardDims(byId.get(id)!).h / 2) }
      x += widths[i] + GUT
    })
  }

  // The rest: a loose grid well below the tree.
  const loose = cards.filter((c) => !inTree.has(c.id))
  if (loose.length) {
    const looseDims = loose.map((c) => cardDims(c))
    const cell = Math.max(320, ...looseDims.map((d) => d.w)) + GUT
    const cols = Math.max(2, Math.ceil(Math.sqrt(loose.length * 1.5)))
    const y0 = depthOffset + 260
    const looseRows = Math.ceil(loose.length / cols)
    const looseRowHeights = new Array<number>(looseRows).fill(0)
    looseDims.forEach((d, i) => { looseRowHeights[Math.floor(i / cols)] = Math.max(looseRowHeights[Math.floor(i / cols)], d.h) })
    loose.forEach((c, i) => {
      const row = Math.floor(i / cols)
      let rowY = y0
      for (let r = 0; r < row; r++) rowY += looseRowHeights[r] + GUT
      positions[c.id] = {
        x: ((i % cols) - (cols - 1) / 2) * cell,
        y: rowY + looseDims[i].h / 2,
      }
    })
  }
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
