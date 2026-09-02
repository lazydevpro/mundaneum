import { describe, expect, it } from 'vitest'
import { boardImageContent, boardSnapshot } from './boardSnapshot'
import type { Card } from './types'

const card: Card = {
  id: 'c1', type: 'text', content: 'A card on the board',
  addedBy: 'human', addedAt: 1, accepted: true,
}

describe('whole-board visual snapshot', () => {
  const board = {
    boardName: 'Visual test',
    cards: { c1: card },
    positions: { c1: { x: 200, y: 100 } },
    links: {},
    strokes: [
      { id: 'ink', kind: 'draw' as const, points: [{ x: -80, y: -40 }, { x: -30, y: 20 }] },
      { id: 'label', kind: 'text' as const, points: [{ x: 20, y: 220 }], text: 'direct drawing text', fontSize: 18 },
    ],
  }

  it('renders cards and direct drawings together at board coordinates', () => {
    const svg = boardSnapshot(board)
    expect(svg).toContain('A card on the board')
    expect(svg).toContain('points="-80,-40 -30,20"')
    expect(svg).toContain('direct drawing text')
    expect(svg).toContain('x="20" y="238" font-size="18"')
  })

  it('returns native image content for MCP clients', () => {
    const image = boardImageContent(board)
    expect(image.mimeType).toBe('image/svg+xml')
    expect(atob(image.data)).toContain('Visual test')
  })
})
