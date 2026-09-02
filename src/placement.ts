import { cardDims } from './embed/dims'
import type { Card, XY } from './types'

const GAP = 28
const STEP = 72
const MAX_RINGS = 80

function overlaps(a: XY, aw: number, ah: number, b: XY, bw: number, bh: number): boolean {
  return (
    Math.abs(a.x - b.x) < (aw + bw) / 2 + GAP &&
    Math.abs(a.y - b.y) < (ah + bh) / 2 + GAP
  )
}

/**
 * Find the nearest empty position to the requested landing point.
 * Candidates follow expanding square rings, so dense boards grow outward
 * predictably without stacking new cards on top of existing material.
 */
export function findOpenPosition(
  card: Card,
  preferred: XY,
  cards: Record<string, Card>,
  positions: Record<string, XY>,
): XY {
  const own = cardDims(card)
  const occupied = Object.values(cards)
    .filter((other) => other.id !== card.id && !other.mergedInto && positions[other.id])
    .map((other) => ({ pos: positions[other.id], dims: cardDims(other) }))

  const free = (candidate: XY) =>
    occupied.every(({ pos, dims }) => !overlaps(candidate, own.w, own.h, pos, dims.w, dims.h))

  if (free(preferred)) return preferred

  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    const radius = ring * STEP
    // Walk each square edge. This samples uniformly without repeatedly
    // crowding the horizontal axis like a simple circular spiral can.
    for (let offset = -radius; offset <= radius; offset += STEP) {
      const candidates = [
        { x: preferred.x + offset, y: preferred.y - radius },
        { x: preferred.x + radius, y: preferred.y + offset },
        { x: preferred.x - offset, y: preferred.y + radius },
        { x: preferred.x - radius, y: preferred.y - offset },
      ]
      for (const candidate of candidates) {
        if (free(candidate)) return candidate
      }
    }
  }

  // A board would need to be extraordinarily dense to reach this fallback.
  return { x: preferred.x + (MAX_RINGS + 1) * STEP, y: preferred.y }
}
