import RBush from 'rbush'
import type { XY } from '../types'

interface Item {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
}

/** Spatial index so agents can query a region without pulling the whole board. */
class SpatialIndex {
  private tree = new RBush<Item>()

  rebuild(entries: Array<{ id: string; x: number; y: number; w: number; h: number }>) {
    this.tree = new RBush<Item>()
    this.tree.load(
      entries.map((e) => ({
        id: e.id,
        minX: e.x - e.w / 2,
        minY: e.y - e.h / 2,
        maxX: e.x + e.w / 2,
        maxY: e.y + e.h / 2,
      })),
    )
  }

  searchRect(minX: number, minY: number, maxX: number, maxY: number): string[] {
    return this.tree.search({ minX, minY, maxX, maxY }).map((i) => i.id)
  }

  searchPolygon(points: XY[]): string[] {
    if (points.length < 3) return []
    const minX = Math.min(...points.map((p) => p.x))
    const minY = Math.min(...points.map((p) => p.y))
    const maxX = Math.max(...points.map((p) => p.x))
    const maxY = Math.max(...points.map((p) => p.y))
    return this.tree
      .search({ minX, minY, maxX, maxY })
      .filter((i) =>
        pointInPolygon({ x: (i.minX + i.maxX) / 2, y: (i.minY + i.maxY) / 2 }, points),
      )
      .map((i) => i.id)
  }
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

export const spatial = new SpatialIndex()
