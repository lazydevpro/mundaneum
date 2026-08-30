export type CardType = 'text' | 'image' | 'link' | 'sketch' | 'file' | 'video'

export interface Card {
  id: string
  type: CardType
  content: string // text body, URL, or data URL for images/sketches
  title?: string
  addedBy: string // 'human' or an agent name ('claude', 'gemini', 'chatgpt', …)
  addedAt: number
  accepted: boolean // human cards are born accepted; agent cards are provisional
  needs?: string // open handoff request ("transcribe this video")
  servedBy?: string // agent that fulfilled the request
  mergedInto?: string // tombstone left by merge_duplicates
}

export interface Link {
  id: string
  from: string
  to: string
  why: string
  addedBy: string
  addedAt: number
  directed?: boolean
}

/** A community computed by the page from the similarity + link graph. */
export interface Cluster {
  id: number
  label?: string
  labeledBy?: string
  cardIds: string[]
  /** Page-owned geometry. Never exposed through any tool. */
  anchor: { x: number; y: number }
}

/** An agent-assigned label, persisted by membership so it survives recomputes. */
export interface LabelAssignment {
  label: string
  labeledBy: string
  cardIds: string[]
}

export interface XY {
  x: number
  y: number
}

export type EngineStatus = 'cold' | 'warming' | 'ready' | 'embedding' | 'organizing'

export interface ProvenanceFilter {
  mode: 'all' | 'mine' | 'accepted' | 'pending'
  hiddenAgents: string[]
}
