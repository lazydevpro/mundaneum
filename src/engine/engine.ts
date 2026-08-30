import type { Card, Cluster } from '../types'
import { liveCards, useBoard } from '../store'
import { embedCards, embedEvents, warmModel } from './embeddings'
import { buildGraph, duplicateCandidates, topTerms, type BoardGraph } from './graph'
import { runLayout, type LayoutNode } from './layout'
import { spatial } from './spatial'

/** Card footprint used by collision + the spatial index; mirrors CardView CSS. */
export function cardSize(card: Card): { w: number; h: number } {
  const w = 224
  if (card.type === 'image' || card.type === 'sketch') return { w, h: 180 }
  if (card.type === 'video') return { w, h: 150 }
  const chars = (card.title?.length ?? 0) + Math.min(card.content.length, 420)
  return { w, h: Math.min(46 + Math.ceil(chars / 34) * 18, 260) }
}

let latest: BoardGraph | null = null
let organizedOnce = false
let organizing: Promise<void> | null = null
let scheduleTimer: ReturnType<typeof setTimeout> | undefined

export const engineEvents = new EventTarget()

export function latestGraph(): BoardGraph | null {
  return latest
}

export function duplicatePairs(): Array<{ a: string; b: string; sim: number }> {
  return latest ? duplicateCandidates(latest) : []
}

export async function warmEngine(): Promise<void> {
  const s = useBoard.getState()
  if (s.engineStatus !== 'cold') return
  s.setEngine('warming', 'loading model')
  const onProgress = (e: Event) =>
    useBoard.getState().setEngine('warming', 'model ' + (e as CustomEvent<number>).detail + '%')
  embedEvents.addEventListener('progress', onProgress)
  try {
    await warmModel()
    useBoard.getState().setEngine('ready')
  } catch (err) {
    useBoard.getState().setEngine('cold', 'model failed to load')
    console.warn('embed model failed', err)
  } finally {
    embedEvents.removeEventListener('progress', onProgress)
  }
}

/**
 * The full pipeline: embed -> pairwise cosine -> Louvain -> anchored layout.
 * All geometry decided here; nothing an agent sends can influence position
 * except by changing the content itself.
 */
export async function organize(): Promise<void> {
  if (organizing) return organizing
  organizing = doOrganize().finally(() => {
    organizing = null
  })
  return organizing
}

async function doOrganize(): Promise<void> {
  const store = useBoard.getState()
  const cards = liveCards(store.cards)
  if (cards.length < 2) return

  store.setEngine('embedding', '0/' + cards.length)
  let vectors: Map<string, Float32Array>
  try {
    vectors = await embedCards(cards, (done, total) =>
      useBoard.getState().setEngine('embedding', done + '/' + total),
    )
  } catch (err) {
    useBoard.getState().setEngine('ready', 'embedding failed')
    console.warn('embedding failed', err)
    return
  }

  useBoard.getState().setEngine('organizing')
  const links = Object.values(useBoard.getState().links)
  latest = buildGraph(cards, links, vectors)

  // Communities -> clusters (label reattachment happens in the store).
  const byCommunity = new Map<number, Card[]>()
  for (const c of cards) {
    const comm = latest.communities.get(c.id) ?? -1
    if (!byCommunity.has(comm)) byCommunity.set(comm, [])
    byCommunity.get(comm)!.push(c)
  }

  // Singleton communities share one "loose" patch instead of each claiming
  // a grid cell — visually, the unsorted scraps live together at the edge.
  const LOOSE = -2
  const layoutCommunity = (id: string) => {
    const comm = latest!.communities.get(id) ?? -1
    return (byCommunity.get(comm)?.length ?? 0) < 2 ? LOOSE : comm
  }
  const nodes: LayoutNode[] = cards.map((c) => {
    const { w, h } = cardSize(c)
    return { id: c.id, community: layoutCommunity(c.id), w, h, x: 0, y: 0 }
  })
  const edges = latest.graph.edges().map((e) => ({
    source: latest!.graph.source(e),
    target: latest!.graph.target(e),
    weight: latest!.graph.getEdgeAttribute(e, 'weight') as number,
  }))

  const { positions, anchors } = runLayout(nodes, edges)

  const clusters: Cluster[] = [...byCommunity.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([id, members]) => ({
      id,
      cardIds: members.map((m) => m.id),
      anchor: centroid(members.map((m) => positions[m.id] ?? anchors.get(id)!)),
    }))

  const s = useBoard.getState()
  s.setPositions(positions)
  s.setClusters(clusters)
  spatial.rebuild(
    cards.map((c) => {
      const { w, h } = cardSize(c)
      const p = positions[c.id]
      return { id: c.id, x: p.x, y: p.y, w, h }
    }),
  )
  s.setEngine('ready')
  organizedOnce = true
  engineEvents.dispatchEvent(new CustomEvent('organized'))
}

function centroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const n = points.length || 1
  return {
    x: points.reduce((a, p) => a + p.x, 0) / n,
    y: points.reduce((a, p) => a + p.y, 0) / n,
  }
}

/** After agent mutations: fold new material into the layout, debounced. */
export function scheduleOrganize(delay = 1600): void {
  if (!organizedOnce) return
  clearTimeout(scheduleTimer)
  scheduleTimer = setTimeout(() => void organize(), delay)
}

/** Cheap term summaries for get_board / labeling context. */
export function clusterTerms(cluster: Cluster): string[] {
  const cards = useBoard.getState().cards
  return topTerms(cluster.cardIds.map((id) => cards[id]).filter(Boolean))
}
