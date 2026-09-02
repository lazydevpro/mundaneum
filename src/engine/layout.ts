import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
} from 'd3-force'
import type { XY } from '../types'

/**
 * Community-anchored layout. This is mandatory, not an optimization: a plain
 * force layout optimizes edge length, not community cohesion, and scatters a
 * labelled cluster across the board. Each community is pinned to its own
 * forceX/forceY anchor on a coarse grid; force handles only intra-cluster
 * spacing and collision.
 */

export interface LayoutNode extends XY {
  id: string
  community: number
  w: number
  h: number
}

export interface LayoutResult {
  positions: Record<string, XY>
  anchors: Map<number, XY>
}

const CELL = 2000 // grid pitch: inter-cluster gap must beat cluster width

export function communityAnchors(communityIds: number[], sizes: Map<number, number>): Map<number, XY> {
  // Biggest communities near the center, spiraling out on a grid.
  // The loose singleton patch (-2) always takes the outermost cell.
  const ordered = [...communityIds].sort((a, b) => {
    if (a === -2) return 1
    if (b === -2) return -1
    return (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0)
  })
  const anchors = new Map<number, XY>()
  const cells = gridSpiral(ordered.length)
  ordered.forEach((c, i) => {
    anchors.set(c, { x: cells[i].x * CELL, y: cells[i].y * CELL * 0.68 })
  })
  return anchors
}

/** 0,0 then ring by ring outward — keeps the whole board compact. */
function gridSpiral(n: number): XY[] {
  const out: XY[] = [{ x: 0, y: 0 }]
  let ring = 1
  while (out.length < n) {
    for (let dx = -ring; dx <= ring && out.length < n; dx++) {
      for (let dy = -ring; dy <= ring && out.length < n; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        out.push({ x: dx, y: dy })
      }
    }
    ring++
  }
  return out.slice(0, n)
}

export function runLayout(
  nodes: LayoutNode[],
  edges: Array<{ source: string; target: string; weight: number }>,
): LayoutResult {
  const sizes = new Map<number, number>()
  for (const n of nodes) sizes.set(n.community, (sizes.get(n.community) ?? 0) + 1)
  const anchors = communityAnchors([...sizes.keys()], sizes)

  // Start AT the anchors: the sim only resolves intra-cluster spacing.
  // Visual continuity comes from the CSS glide, not the sim's start state.
  const simNodes = nodes.map((n) => ({
    ...n,
    x: anchors.get(n.community)!.x + (Math.random() - 0.5) * 240,
    y: anchors.get(n.community)!.y + (Math.random() - 0.5) * 240,
  }))

  const sim = forceSimulation(simNodes)
    .force('x', forceX<LayoutNode>((d) => anchors.get(d.community)!.x).strength(0.4))
    .force('y', forceY<LayoutNode>((d) => anchors.get(d.community)!.y).strength(0.46))
    .force('charge', forceManyBody().strength(-30).distanceMax(260))
    .force(
      'collide',
      // A circle enclosing each rectangle guarantees the actual card boxes
      // cannot overlap, including tall documents and live widgets.
      forceCollide<LayoutNode>((d) => Math.hypot(d.w, d.h) / 2 + 22).iterations(5),
    )
    .force(
      'link',
      forceLink<LayoutNode, { source: string; target: string; weight: number }>(edges)
        .id((d) => d.id)
        .distance(140)
        .strength((l) => Math.min(0.18, l.weight * 0.12)),
    )
    .stop()

  // Run to completion synchronously (~150 nodes is a few ms); the UI then
  // CSS-glides cards to their targets — the "snap into place" shot.
  const ticks = Math.ceil(Math.log(0.001) / Math.log(1 - sim.alphaDecay()))
  for (let i = 0; i < Math.min(ticks, 320); i++) sim.tick()

  const positions: Record<string, XY> = {}
  for (const n of simNodes) positions[n.id] = { x: n.x!, y: n.y! }
  return { positions, anchors }
}
