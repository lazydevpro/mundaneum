import { describe, expect, it } from 'vitest'
import { arrangePositions } from './arrange'
import type { Card } from '../types'
import { cardDims } from '../embed/dims'

const widget = (id: string, height: number): Card => ({
  id, type: 'widget', content: '<html/>', title: id,
  displaySize: { width: 320, height }, addedBy: 'human', addedAt: 1, accepted: true,
})

describe('grid arrangement', () => {
  it('uses live card footprints so tall widgets do not overlap rows', () => {
    const cards = [widget('a', 360), widget('b', 360), widget('c', 600), widget('d', 220)]
    const positions = arrangePositions(cards, 'grid', () => undefined)
    const a = positions.a
    // Four cards produce three columns, so d is the first card in row two.
    const d = positions.d
    const aDims = cardDims(cards[0])
    const dDims = cardDims(cards[3])
    expect(Math.abs(d.y - a.y)).toBeGreaterThanOrEqual((aDims.h + dDims.h) / 2 + 26)
  })

  it('keeps masonry columns apart when cards are wider than the default cell', () => {
    const cards = [widget('a', 360), { ...widget('b', 360), displaySize: { width: 600, height: 360 } }]
    const positions = arrangePositions(cards, 'masonry', () => undefined)
    expect(Math.abs(positions.b.x - positions.a.x)).toBeGreaterThanOrEqual(600 + 26)
  })

  it('spaces tree layers by their tallest card', () => {
    const cards = [widget('a', 700), widget('b', 220)]
    const links = [{ id: 'l', from: 'a', to: 'b', why: 'sequence', addedBy: 'human', addedAt: 1, directed: true as const }]
    const positions = arrangePositions(cards, 'tree', () => undefined, links)
    expect(Math.abs(positions.b.y - positions.a.y)).toBeGreaterThanOrEqual((730 + 250) / 2 + 26)
  })
})
