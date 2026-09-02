import { describe, expect, it } from 'vitest'
import { cardDims } from './embed/dims'
import { findOpenPosition } from './placement'
import type { Card, XY } from './types'

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id, type: 'text', content: id, addedBy: 'human', addedAt: 1, accepted: true, ...patch,
  }
}

function separated(a: Card, ap: XY, b: Card, bp: XY): boolean {
  const ad = cardDims(a)
  const bd = cardDims(b)
  return (
    Math.abs(ap.x - bp.x) >= (ad.w + bd.w) / 2 + 28 ||
    Math.abs(ap.y - bp.y) >= (ad.h + bd.h) / 2 + 28
  )
}

describe('new-card placement', () => {
  it('uses the preferred point when it is empty', () => {
    const incoming = card('new')
    expect(findOpenPosition(incoming, { x: 40, y: 70 }, { new: incoming }, {})).toEqual({ x: 40, y: 70 })
  })

  it('moves a new card to the nearest available ring instead of overlapping', () => {
    const existing = card('old')
    const incoming = card('new')
    const cards = { old: existing, new: incoming }
    const positions = { old: { x: 0, y: 0 } }
    const placed = findOpenPosition(incoming, { x: 0, y: 0 }, cards, positions)
    expect(placed).not.toEqual({ x: 0, y: 0 })
    expect(separated(existing, positions.old, incoming, placed)).toBe(true)
  })

  it('accounts for cards resized much larger than their defaults', () => {
    const widget = card('widget', {
      type: 'widget',
      displaySize: { width: 700, height: 600 },
    })
    const incoming = card('new', {
      type: 'canvas',
      document: { text: '', strokes: [], width: 500, height: 400 },
    })
    const placed = findOpenPosition(
      incoming,
      { x: 0, y: 0 },
      { widget, new: incoming },
      { widget: { x: 0, y: 0 } },
    )
    expect(separated(widget, { x: 0, y: 0 }, incoming, placed)).toBe(true)
  })

  it('keeps every card in a batch separate', () => {
    const cards: Record<string, Card> = {}
    const positions: Record<string, XY> = {}
    for (let i = 0; i < 8; i++) {
      const next = card('c' + i)
      cards[next.id] = next
      positions[next.id] = findOpenPosition(next, { x: 0, y: 0 }, cards, positions)
    }
    const ids = Object.keys(cards)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(separated(cards[ids[i]], positions[ids[i]], cards[ids[j]], positions[ids[j]])).toBe(true)
      }
    }
  })
})
