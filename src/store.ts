import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type {
  AgentToolDef, Annotation, Card, CardMeta, CardType, Cluster, EngineStatus,
  LabelAssignment, Link, ProvenanceFilter, Stroke, ViewPrefs, XY,
} from './types'
import type { RuntimeProvider } from './embed/providers'
import { deleteAsset } from './capture/assets'
import { currentBoardId, newId } from './boardId'

export interface AgentActivity {
  id: string
  agent: string
  text: string
  at: number
}

interface BoardState {
  boardId: string
  boardName: string
  cards: Record<string, Card>
  links: Record<string, Link>
  /** Page-owned geometry. Cards glide to these targets; agents never see them. */
  positions: Record<string, XY>
  clusters: Cluster[]
  labels: LabelAssignment[]
  strokes: Stroke[]
  annotations: Annotation[]
  agentProviders: RuntimeProvider[]
  agentTools: AgentToolDef[]
  prefs: ViewPrefs
  filters: ProvenanceFilter
  selection: string[]
  engineStatus: EngineStatus
  engineDetail: string
  activity: AgentActivity[]
  loaded: boolean

  addCards(
    items: Array<{
      content: string
      type?: CardType
      title?: string
      meta?: CardMeta
      embedMode?: 'face' | 'live'
      needs?: string
      forCard?: string
      at?: XY
    }>,
    by: string,
  ): Card[]
  updateCard(id: string, patch: Partial<Card>): void
  removeCard(id: string): void
  acceptCard(id: string): void
  rejectCard(id: string): void
  addLinks(
    items: Array<{ from: string; to: string; why: string; directed?: boolean }>,
    by: string,
  ): Link[]
  mergeCards(pairs: Array<{ keep: string; remove: string }>, by: string): number
  requestHelp(cardId: string, needs: string, by: string): void
  labelCluster(clusterId: number, label: string, by: string): boolean
  moveCard(id: string, xy: XY): void
  setPositions(p: Record<string, XY>): void
  setClusters(c: Cluster[]): void
  setSelection(ids: string[]): void
  setFilters(f: Partial<ProvenanceFilter>): void
  setEngine(status: EngineStatus, detail?: string): void
  logActivity(agent: string, text: string): void
  renameBoard(name: string): void
  replaceBoard(data: Persisted): void
  removeLink(id: string): void
  addStroke(s: Omit<Stroke, 'id'>): void
  undoStroke(): void
  removeStrokes(ids: string[]): void
  addAnnotation(a: Omit<Annotation, 'id'>): void
  removeAnnotations(ids: string[]): void
  addGroup(name: string, cardIds: string[], by: string): void
  saveAgentProvider(p: RuntimeProvider): void
  saveAgentTool(def: AgentToolDef): void
  removeAgentExtension(kind: 'provider' | 'tool', id: string): void
  setPrefs(p: Partial<ViewPrefs>): void
}

export interface Persisted {
  boardName: string
  cards: Record<string, Card>
  links: Record<string, Link>
  positions: Record<string, XY>
  labels: LabelAssignment[]
  strokes?: Stroke[]
  annotations?: Annotation[]
  agentProviders?: RuntimeProvider[]
  agentTools?: AgentToolDef[]
  prefs?: ViewPrefs
}

const DEFAULT_PREFS: ViewPrefs = { style: 'pure', arrangement: 'clusters', toolbar: 'hidden' }

/** New cards land near the current viewport center; the canvas registers this. */
export const dropTarget: { current: () => XY } = {
  current: () => ({ x: 0, y: 0 }),
}

let seq = 0
const jitter = (r: number) => (Math.random() - 0.5) * 2 * r

export const useBoard = create<BoardState>((set, get) => ({
  boardId: currentBoardId(),
  boardName: 'Untitled board',
  cards: {},
  links: {},
  positions: {},
  clusters: [],
  labels: [],
  strokes: [],
  annotations: [],
  agentProviders: [],
  agentTools: [],
  prefs: { ...DEFAULT_PREFS },
  filters: { mode: 'all', hiddenAgents: [] },
  selection: [],
  engineStatus: 'cold',
  engineDetail: '',
  activity: [],
  loaded: false,

  addCards(items, by) {
    const created: Card[] = []
    const positions = { ...get().positions }
    const cards = { ...get().cards }
    const links = { ...get().links }
    for (const it of items) {
      const id = newId('c')
      const card: Card = {
        id,
        type: it.type ?? 'text',
        content: it.content,
        title: it.title,
        meta: it.meta,
        embedMode: it.embedMode,
        addedBy: by,
        addedAt: Date.now() + seq++,
        accepted: by === 'human',
        needs: it.needs,
      }
      cards[id] = card
      const base = it.at ?? dropTarget.current()
      positions[id] = { x: base.x + jitter(140), y: base.y + jitter(100) }
      created.push(card)
      if (it.forCard && cards[it.forCard]) {
        // Serving a handoff: link the contribution and close the request.
        const target = cards[it.forCard]
        cards[it.forCard] = { ...target, needs: undefined, servedBy: by }
        const lid = newId('l')
        links[lid] = {
          id: lid, from: id, to: it.forCard,
          why: 'serves request: ' + (target.needs ?? 'help'),
          addedBy: by, addedAt: Date.now(), directed: true,
        }
      }
    }
    set({ cards, positions, links })
    return created
  },

  updateCard(id, patch) {
    const c = get().cards[id]
    if (!c) return
    set({ cards: { ...get().cards, [id]: { ...c, ...patch } } })
  },

  removeCard(id) {
    const cards = { ...get().cards }
    const positions = { ...get().positions }
    const links = { ...get().links }
    const asset = cards[id]?.meta?.asset
    if (asset) void deleteAsset(asset)
    delete cards[id]
    delete positions[id]
    for (const [lid, l] of Object.entries(links)) {
      if (l.from === id || l.to === id) delete links[lid]
    }
    set({ cards, positions, links, selection: get().selection.filter((s) => s !== id) })
  },

  acceptCard(id) {
    get().updateCard(id, { accepted: true })
  },

  rejectCard(id) {
    get().removeCard(id)
  },

  addLinks(items, by) {
    const links = { ...get().links }
    const { cards } = get()
    const made: Link[] = []
    for (const it of items) {
      if (!cards[it.from] || !cards[it.to] || it.from === it.to) continue
      const dup = Object.values(links).some(
        (l) =>
          (l.from === it.from && l.to === it.to) ||
          (!l.directed && l.from === it.to && l.to === it.from),
      )
      if (dup) continue
      const id = newId('l')
      const link: Link = {
        id, from: it.from, to: it.to, why: it.why,
        addedBy: by, addedAt: Date.now(), directed: it.directed,
      }
      links[id] = link
      made.push(link)
    }
    set({ links })
    return made
  },

  mergeCards(pairs, by) {
    const cards = { ...get().cards }
    const links = { ...get().links }
    const positions = { ...get().positions }
    let n = 0
    for (const { keep, remove } of pairs) {
      if (!cards[keep] || !cards[remove] || keep === remove) continue
      // Tombstone, transfer links, drop geometry.
      cards[remove] = { ...cards[remove], mergedInto: keep }
      for (const [lid, l] of Object.entries(links)) {
        const from = l.from === remove ? keep : l.from
        const to = l.to === remove ? keep : l.to
        if (from === to) delete links[lid]
        else links[lid] = { ...l, from, to }
      }
      delete positions[remove]
      n++
    }
    if (n) {
      set({ cards, links, positions })
      get().logActivity(by, 'merged ' + n + ' duplicate' + (n > 1 ? 's' : ''))
    }
    return n
  },

  requestHelp(cardId, needs, by) {
    get().updateCard(cardId, { needs, servedBy: undefined })
    get().logActivity(by, 'asked for help: "' + needs + '"')
  },

  labelCluster(clusterId, label, by) {
    const cluster = get().clusters.find((c) => c.id === clusterId)
    if (!cluster) return false
    const labels = get().labels.filter((l) => l.label !== label)
    labels.push({ label, labeledBy: by, cardIds: [...cluster.cardIds] })
    set({
      labels,
      // One name, one cluster: a label moves if reused elsewhere.
      clusters: get().clusters.map((c) => {
        if (c.id === clusterId) return { ...c, label, labeledBy: by }
        if (c.label === label) return { ...c, label: undefined, labeledBy: undefined }
        return c
      }),
    })
    return true
  },

  moveCard(id, xy) {
    set({ positions: { ...get().positions, [id]: xy } })
  },

  setPositions(p) {
    set({ positions: { ...get().positions, ...p } })
  },

  setClusters(clusters) {
    // Reattach persisted labels to recomputed communities by best Jaccard overlap.
    const labels = get().labels
    const withLabels = clusters.map((c) => {
      let best: LabelAssignment | undefined
      let bestScore = 0.3
      for (const l of labels) {
        const setA = new Set(l.cardIds)
        const inter = c.cardIds.filter((id) => setA.has(id)).length
        const union = new Set([...l.cardIds, ...c.cardIds]).size
        const score = union ? inter / union : 0
        if (score > bestScore) {
          best = l
          bestScore = score
        }
      }
      return best ? { ...c, label: best.label, labeledBy: best.labeledBy } : c
    })
    set({ clusters: withLabels })
  },

  setSelection(ids) {
    set({ selection: ids })
  },

  setFilters(f) {
    set({ filters: { ...get().filters, ...f } })
  },

  setEngine(status, detail = '') {
    set({ engineStatus: status, engineDetail: detail })
  },

  logActivity(agent, text) {
    const activity = [
      { id: newId('a'), agent, text, at: Date.now() },
      ...get().activity,
    ].slice(0, 60)
    set({ activity })
  },

  renameBoard(name) {
    set({ boardName: name || 'Untitled board' })
  },

  replaceBoard(data) {
    set({
      boardName: data.boardName,
      cards: data.cards,
      links: data.links,
      positions: data.positions,
      labels: data.labels,
      strokes: data.strokes ?? [],
      annotations: data.annotations ?? [],
      agentProviders: data.agentProviders ?? [],
      agentTools: data.agentTools ?? [],
      prefs: { ...DEFAULT_PREFS, ...data.prefs },
      clusters: [],
      selection: [],
    })
  },

  removeLink(id) {
    const links = { ...get().links }
    delete links[id]
    set({ links })
  },

  addStroke(stroke) {
    set({ strokes: [...get().strokes, { ...stroke, id: newId('s') }] })
  },

  undoStroke() {
    set({ strokes: get().strokes.slice(0, -1) })
  },

  removeStrokes(ids) {
    const gone = new Set(ids)
    set({ strokes: get().strokes.filter((st) => !gone.has(st.id)) })
  },

  addAnnotation(a) {
    set({ annotations: [...get().annotations, { ...a, id: newId('an') }] })
  },

  removeAnnotations(ids) {
    const gone = new Set(ids)
    set({ annotations: get().annotations.filter((an) => !gone.has(an.id)) })
  },

  /** A declared group: clustering keeps these together and names the cluster. */
  addGroup(name, cardIds, by) {
    const labels = get().labels.filter((l) => l.label !== name)
    labels.push({ label: name, labeledBy: by, cardIds: [...cardIds] })
    set({ labels })
  },

  saveAgentProvider(p) {
    set({ agentProviders: [p, ...get().agentProviders.filter((x) => x.key !== p.key)] })
  },

  saveAgentTool(def) {
    set({ agentTools: [def, ...get().agentTools.filter((x) => x.name !== def.name)] })
  },

  removeAgentExtension(kind, id) {
    if (kind === 'provider') {
      set({ agentProviders: get().agentProviders.filter((p) => p.key !== id) })
    } else {
      set({ agentTools: get().agentTools.filter((t) => t.name !== id) })
    }
  },

  setPrefs(p) {
    set({ prefs: { ...get().prefs, ...p } })
  },
}))

// ---------- persistence ----------

const key = (id: string) => 'mundaneum:' + id
let saveTimer: ReturnType<typeof setTimeout> | undefined

export async function loadBoard(): Promise<void> {
  const s = useBoard.getState()
  const data = (await idbGet(key(s.boardId))) as Persisted | undefined
  if (data) s.replaceBoard(data)
  useBoard.setState({ loaded: true })
}

useBoard.subscribe((s) => {
  if (!s.loaded) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data: Persisted = {
      boardName: s.boardName,
      cards: s.cards,
      links: s.links,
      positions: s.positions,
      labels: s.labels,
      strokes: s.strokes,
      annotations: s.annotations,
      agentProviders: s.agentProviders,
      agentTools: s.agentTools,
      prefs: s.prefs,
    }
    void idbSet(key(s.boardId), data)
  }, 400)
})

// ---------- shared selectors ----------

export const liveCards = (cards: Record<string, Card>): Card[] =>
  Object.values(cards).filter((c) => !c.mergedInto)

export function visibleCards(s: {
  cards: Record<string, Card>
  filters: ProvenanceFilter
}): Card[] {
  return liveCards(s.cards).filter((c) => {
    if (s.filters.hiddenAgents.includes(c.addedBy)) return false
    switch (s.filters.mode) {
      case 'mine': return c.addedBy === 'human'
      case 'accepted': return c.accepted
      case 'pending': return !c.accepted
      default: return true
    }
  })
}
