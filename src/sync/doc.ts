import type { Annotation, Card, LabelAssignment, Link, Stroke, ViewPrefs, XY } from '../types'

/**
 * The shared board document and its merge rule.
 *
 * Deliberately NOT a CRDT: this is a research board, not a text editor, and
 * per-entity last-write-wins is honest about what actually happens when two
 * people touch the same card — the later edit stands. Every entity carries a
 * timestamp; deletions leave tombstones so a delete can't be resurrected by a
 * stale peer.
 *
 * What travels: cards (including images, which are small compressed data
 * URLs), links, labels, positions, ink, annotations, prefs. What never
 * travels: the Blob asset store — video, 3D models, documents. Those stay on
 * the device that added them, and their card syncs as a placeholder. That
 * single rule is what keeps hosting free.
 */

export interface SyncDoc {
  v: 1
  boardName: string
  updatedAt: number
  cards: Record<string, Card>
  links: Record<string, Link>
  positions: Record<string, XY>
  labels: LabelAssignment[]
  strokes: Stroke[]
  annotations: Annotation[]
  prefs: ViewPrefs
  /** id -> deletion time, so a delete beats a stale copy of the card. */
  deleted: Record<string, number>
}

/** Cards whose payload is a local Blob can't travel; their card still can. */
export function stripLocalAssets(cards: Record<string, Card>): Record<string, Card> {
  const out: Record<string, Card> = {}
  for (const [id, c] of Object.entries(cards)) {
    if (c.meta?.asset) {
      const { asset: _asset, ...meta } = c.meta
      out[id] = { ...c, meta: { ...meta, remote: true } }
    } else {
      out[id] = c
    }
  }
  return out
}

const stamp = (c: Card): number => c.updatedAt ?? c.addedAt

/**
 * Merge two documents. Symmetric and idempotent: merge(a,b) === merge(b,a),
 * and merging twice changes nothing — so a client can safely re-send.
 */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const deleted: Record<string, number> = { ...a.deleted }
  for (const [id, t] of Object.entries(b.deleted)) {
    deleted[id] = Math.max(deleted[id] ?? 0, t)
  }

  const cards: Record<string, Card> = {}
  for (const id of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
    const ca = a.cards[id]
    const cb = b.cards[id]
    const winner = !ca ? cb : !cb ? ca : stamp(cb) > stamp(ca) ? cb : ca
    if (!winner) continue
    // A tombstone newer than the surviving edit wins.
    if ((deleted[id] ?? 0) > stamp(winner)) continue
    // Prefer whichever copy still has its local asset handle.
    const withAsset = ca?.meta?.asset ? ca : cb?.meta?.asset ? cb : null
    cards[id] = withAsset && withAsset !== winner
      ? { ...winner, meta: { ...winner.meta, asset: withAsset.meta!.asset } }
      : winner
  }

  const links: Record<string, Link> = {}
  for (const id of new Set([...Object.keys(a.links), ...Object.keys(b.links)])) {
    if (deleted[id]) continue
    const l = a.links[id] ?? b.links[id]
    // A link to a card that lost is dead weight.
    if (cards[l.from] && cards[l.to]) links[id] = l
  }

  const newer = b.updatedAt > a.updatedAt ? b : a
  const older = newer === b ? a : b

  // Positions: page-computed, but both sides should agree — take the newer
  // document's, falling back to the older for cards it hasn't seen.
  const positions: Record<string, XY> = {}
  for (const id of Object.keys(cards)) {
    positions[id] = newer.positions[id] ?? older.positions[id] ?? { x: 0, y: 0 }
  }

  const byLabel = new Map<string, LabelAssignment>()
  for (const l of [...older.labels, ...newer.labels]) byLabel.set(l.label, l)

  const strokeIds = new Set<string>()
  const strokes = [...a.strokes, ...b.strokes].filter((s) => {
    if (strokeIds.has(s.id) || deleted[s.id]) return false
    strokeIds.add(s.id)
    return true
  })

  const annIds = new Set<string>()
  const annotations = [...a.annotations, ...b.annotations].filter((an) => {
    if (annIds.has(an.id) || deleted[an.id]) return false
    annIds.add(an.id)
    return true
  })

  return {
    v: 1,
    boardName: newer.boardName,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    cards,
    links,
    positions,
    labels: [...byLabel.values()],
    strokes: strokes.slice(-600),
    annotations: annotations.slice(-200),
    prefs: newer.prefs,
    deleted: capDeleted(deleted),
  }
}

/** Tombstones are forever in principle; in practice the newest 2000 suffice. */
function capDeleted(deleted: Record<string, number>): Record<string, number> {
  const entries = Object.entries(deleted)
  if (entries.length <= 2000) return deleted
  return Object.fromEntries(entries.sort((x, y) => y[1] - x[1]).slice(0, 2000))
}

export function docBytes(doc: SyncDoc): number {
  return new Blob([JSON.stringify(doc)]).size
}
