import { describe, expect, it } from 'vitest'
import { mergeDocs, stripLocalAssets, type SyncDoc } from './doc'
import type { Card, Link, ViewPrefs } from '../types'

/**
 * The merge is the only place two devices can silently lose each other's work,
 * so its promises are worth pinning down: symmetric, idempotent, later edit
 * wins, and a delete is not resurrected by a peer that hasn't heard about it.
 */

const PREFS: ViewPrefs = { theme: 'mint', style: 'pure', arrangement: 'clusters' } as ViewPrefs

function card(id: string, at: number, over: Partial<Card> = {}): Card {
  return {
    id, type: 'text', content: id, addedBy: 'human', addedAt: at, accepted: true, ...over,
  }
}

function link(id: string, from: string, to: string): Link {
  return { id, from, to, why: 'because', addedBy: 'claude', addedAt: 1 }
}

function doc(over: Partial<SyncDoc> = {}): SyncDoc {
  return {
    v: 1,
    boardName: 'board',
    updatedAt: 1000,
    cards: {},
    links: {},
    positions: {},
    labels: [],
    strokes: [],
    annotations: [],
    prefs: PREFS,
    deleted: {},
    ...over,
  }
}

const ids = (d: SyncDoc) => Object.keys(d.cards).sort()

describe('mergeDocs — cards', () => {
  it('unions cards from both sides', () => {
    const a = doc({ cards: { a: card('a', 1) } })
    const b = doc({ cards: { b: card('b', 1) } })
    expect(ids(mergeDocs(a, b))).toEqual(['a', 'b'])
  })

  it('keeps the later edit of the same card', () => {
    const a = doc({ cards: { x: card('x', 1, { content: 'old', updatedAt: 10 }) } })
    const b = doc({ cards: { x: card('x', 1, { content: 'new', updatedAt: 20 }) } })
    expect(mergeDocs(a, b).cards.x.content).toBe('new')
    expect(mergeDocs(b, a).cards.x.content).toBe('new')
  })

  it('is symmetric and idempotent', () => {
    const a = doc({
      updatedAt: 1000,
      cards: { x: card('x', 1, { updatedAt: 5 }), y: card('y', 2) },
      deleted: { gone: 50 },
    })
    const b = doc({
      updatedAt: 2000,
      cards: { x: card('x', 1, { content: 'newer', updatedAt: 9 }), z: card('z', 3) },
    })
    const ab = mergeDocs(a, b)
    const ba = mergeDocs(b, a)
    expect(ids(ab)).toEqual(ids(ba))
    expect(ab.cards.x.content).toBe(ba.cards.x.content)
    // Re-merging a copy we already folded in changes nothing.
    expect(ids(mergeDocs(ab, b))).toEqual(ids(ab))
    expect(mergeDocs(ab, b).cards.x.content).toBe(ab.cards.x.content)
  })

  it('lets a tombstone bury a card a stale peer still holds', () => {
    const a = doc({ cards: {}, deleted: { x: 100 } })
    const b = doc({ cards: { x: card('x', 1, { updatedAt: 50 }) } })
    expect(ids(mergeDocs(a, b))).toEqual([])
    expect(ids(mergeDocs(b, a))).toEqual([])
  })

  it('lets an edit made after the delete win', () => {
    const a = doc({ cards: {}, deleted: { x: 100 } })
    const b = doc({ cards: { x: card('x', 1, { updatedAt: 150 }) } })
    expect(ids(mergeDocs(a, b))).toEqual(['x'])
  })

  it('keeps the local asset handle when the other side lost it', () => {
    const local = doc({ cards: { m: card('m', 1, { meta: { asset: 'blob-1' } }) } })
    const remote = doc({
      cards: { m: card('m', 1, { updatedAt: 99, meta: { remote: true } }) },
    })
    expect(mergeDocs(local, remote).cards.m.meta?.asset).toBe('blob-1')
  })

  it('drops links whose endpoints did not survive', () => {
    const a = doc({
      cards: { x: card('x', 1) },
      links: { l: link('l', 'x', 'gone') },
      deleted: { gone: 500 },
    })
    const b = doc({ cards: { gone: card('gone', 1, { updatedAt: 5 }) } })
    expect(Object.keys(mergeDocs(a, b).links)).toEqual([])
  })
})

describe('mergeDocs — agent extensions', () => {
  const provider = (key: string, at: number, site = key) => ({
    key, site, hostContains: key + '.com', type: 'link' as const, at,
  })
  const tool = (name: string, at: number) => ({
    name, description: 'd', inputSchema: {}, steps: [], by: 'claude', at,
  })

  it('carries platforms an agent taught the other device', () => {
    const a = doc({ agentProviders: [provider('pinterest', 10)] })
    const b = doc()
    expect(mergeDocs(a, b).agentProviders?.map((p) => p.key)).toEqual(['pinterest'])
    expect(mergeDocs(b, a).agentProviders?.map((p) => p.key)).toEqual(['pinterest'])
  })

  it('keeps the newest teaching of the same key', () => {
    const a = doc({ agentProviders: [provider('pin', 10, 'old')] })
    const b = doc({ agentProviders: [provider('pin', 20, 'new')] })
    expect(mergeDocs(a, b).agentProviders?.[0].site).toBe('new')
    expect(mergeDocs(b, a).agentProviders?.[0].site).toBe('new')
  })

  it('does not resurrect one removed on another device', () => {
    const removed = doc({ agentProviders: [], deleted: { 'provider:pin': 100 } })
    const stale = doc({ agentProviders: [provider('pin', 10)] })
    expect(mergeDocs(removed, stale).agentProviders).toEqual([])
    expect(mergeDocs(stale, removed).agentProviders).toEqual([])
  })

  it('lets it be taught again after removal', () => {
    const removed = doc({ agentProviders: [], deleted: { 'provider:pin': 100 } })
    const retaught = doc({ agentProviders: [provider('pin', 150)] })
    expect(mergeDocs(removed, retaught).agentProviders?.map((p) => p.key)).toEqual(['pin'])
  })

  it('merges agent-built tools by name', () => {
    const a = doc({ agentTools: [tool('pin_it', 10)] })
    const b = doc({ agentTools: [tool('pin_it', 30), tool('other', 1)] })
    const names = mergeDocs(a, b).agentTools?.map((t) => t.name).sort()
    expect(names).toEqual(['other', 'pin_it'])
    expect(mergeDocs(a, b).agentTools?.find((t) => t.name === 'pin_it')?.at).toBe(30)
  })

  it('survives documents written before extensions travelled', () => {
    const old = doc()
    delete old.agentProviders
    delete old.agentTools
    expect(() => mergeDocs(old, doc())).not.toThrow()
    expect(mergeDocs(old, doc({ agentTools: [tool('t', 1)] })).agentTools?.length).toBe(1)
  })
})

describe('stripLocalAssets', () => {
  it('removes the blob handle but keeps the card', () => {
    const out = stripLocalAssets({
      m: card('m', 1, { meta: { asset: 'blob-1', filename: 'a.glb' } }),
      t: card('t', 1),
    })
    expect(out.m.meta?.asset).toBeUndefined()
    expect(out.m.meta?.remote).toBe(true)
    expect(out.m.meta?.filename).toBe('a.glb')
    expect(out.t).toBeDefined()
  })
})
