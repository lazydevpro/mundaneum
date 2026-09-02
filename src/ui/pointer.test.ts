import { describe, expect, it } from 'vitest'
import { isDirectDisplayPen, isIosLike, pointerSamples } from './pointer'

describe('tablet pointer handling', () => {
  it('only treats a pen on a touch-capable display as direct', () => {
    expect(isDirectDisplayPen({ pointerType: 'pen' }, 5)).toBe(true)
    expect(isDirectDisplayPen({ pointerType: 'pen' }, 0)).toBe(false)
    expect(isDirectDisplayPen({ pointerType: 'touch' }, 5)).toBe(false)
  })

  it('recognizes iPadOS desktop user agents', () => {
    expect(isIosLike('Mozilla/5.0 (iPad)', 'iPad', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (X11; Linux)', 'Linux x86_64', 5)).toBe(false)
  })

  it('uses coalesced samples off iOS and the dispatched sample on iOS', () => {
    const event = {
      pointerType: 'pen', clientX: 3, clientY: 4,
      getCoalescedEvents: () => [
        { clientX: 1, clientY: 2 },
        { clientX: 3, clientY: 4 },
      ] as PointerEvent[],
    }
    expect(pointerSamples(event, false)).toHaveLength(2)
    expect(pointerSamples(event, true)).toEqual([event])
  })
})
