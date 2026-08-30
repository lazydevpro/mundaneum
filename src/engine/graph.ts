import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { Card, LabelAssignment, Link } from '../types'

/**
 * The page does the O(n^2) work so agents spend context on judgment.
 * Exhaustive pairwise cosine over unit vectors, kept edges = above-threshold
 * plus each node's top-k, so sparse boards stay connected enough to cluster.
 */

export interface BoardGraph {
  graph: Graph
  communities: Map<string, number>
  orphans: string[]
  similar: Array<{ a: string; b: string; sim: number }>
}

const SIM_THRESHOLD = 0.36
const TOP_K = 3
const DUP_THRESHOLD = 0.88

export function buildGraph(
  cards: Card[],
  links: Link[],
  vectors: Map<string, Float32Array>,
  groups: LabelAssignment[] = [],
): BoardGraph {
  const graph = new Graph({ type: 'undirected', multi: false })
  for (const c of cards) graph.addNode(c.id)

  const ids = cards.map((c) => c.id).filter((id) => vectors.has(id))
  const vecs = ids.map((id) => vectors.get(id)!)
  const n = ids.length

  const similar: Array<{ a: string; b: string; sim: number }> = []
  const topK: Array<Array<{ j: number; sim: number }>> = ids.map(() => [])

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = vecs[i]
      const b = vecs[j]
      let dot = 0
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k]
      if (dot >= SIM_THRESHOLD) similar.push({ a: ids[i], b: ids[j], sim: dot })
      pushTop(topK[i], { j, sim: dot })
      pushTop(topK[j], { j: i, sim: dot })
    }
  }

  const addEdge = (a: string, b: string, w: number) => {
    if (a === b) return
    if (graph.hasEdge(a, b)) {
      const cur = graph.getEdgeAttribute(a, b, 'weight') as number
      if (w > cur) graph.setEdgeAttribute(a, b, 'weight', w)
    } else {
      graph.addEdge(a, b, { weight: w })
    }
  }

  for (const s of similar) addEdge(s.a, s.b, s.sim)
  // top-k below threshold get a soft edge so lone-ish cards still gravitate
  topK.forEach((list, i) => {
    for (const t of list) {
      if (t.sim >= SIM_THRESHOLD) continue
      if (t.sim >= 0.22) addEdge(ids[i], ids[t.j], t.sim * 0.5)
    }
  })
  // explicit agent/human links are strong evidence
  for (const l of links) {
    if (graph.hasNode(l.from) && graph.hasNode(l.to)) addEdge(l.from, l.to, 1.2)
  }
  // declared groups bind hardest: the community must hold together
  for (const g of groups) {
    const members = g.cardIds.filter((id) => graph.hasNode(id)).slice(0, 24)
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) addEdge(members[i], members[j], 2.5)
    }
  }

  const communities = new Map<string, number>()
  if (graph.order > 0) {
    const assignment = louvain(graph, { getEdgeWeight: 'weight', resolution: 1.05 })
    for (const [node, comm] of Object.entries(assignment)) communities.set(node, comm as number)
  }

  const orphans = cards.filter((c) => graph.degree(c.id) === 0).map((c) => c.id)
  similar.sort((x, y) => y.sim - x.sim)
  return { graph, communities, orphans, similar }
}

function pushTop(list: Array<{ j: number; sim: number }>, item: { j: number; sim: number }) {
  list.push(item)
  list.sort((a, b) => b.sim - a.sim)
  if (list.length > TOP_K) list.pop()
}

/** Near-identical pairs, candidates for merge_duplicates. */
export function duplicateCandidates(g: BoardGraph): Array<{ a: string; b: string; sim: number }> {
  return g.similar.filter((s) => s.sim >= DUP_THRESHOLD)
}

const STOP = new Set(
  ('a an the and or of to in on for with is are was were be as at by it this that from ' +
    'we you they he she i not no yes but if then than so what which who how why when ' +
    'https http www com about into over under just more less can could should would').split(' '),
)

/** Cheap tf-based salient terms per community — context for labeling agents. */
export function topTerms(cards: Card[], max = 5): string[] {
  const counts = new Map<string, number>()
  for (const c of cards) {
    const text = ((c.title ?? '') + ' ' + c.content).toLowerCase()
    for (const w of text.split(/[^a-z0-9']+/)) {
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue
      counts.set(w, (counts.get(w) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}
