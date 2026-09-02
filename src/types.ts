export type CardType =
  | 'text'
  | 'image'
  | 'sketch'
  | 'link' // article / generic URL, social-preview face
  | 'video' // YouTube/Vimeo/Loom/… or a dropped video file
  | 'audio' // Spotify/Apple Music/SoundCloud/… or a dropped audio file
  | 'social' // Instagram/TikTok/X post
  | 'model' // 3D file (glb/gltf)
  | 'sheet' // csv/xlsx
  | 'doc' // docx/rtf-ish
  | 'canvas' // one editable document: typed text + handwritten ink
  | 'widget' // agent-authored HTML plugin, sandboxed
  | 'file' // anything else

/** Unfurled metadata for URL cards; parsed preview for file cards. */
export interface CardMeta {
  title?: string
  description?: string
  image?: string // face thumbnail (url or data url)
  site?: string // "YouTube", "The Verge"
  provider?: string // registry key: 'youtube', 'spotify', 'article', …
  embedUrl?: string // what the live iframe loads
  asset?: string // asset store id for dropped files
  filename?: string
  preview?: string[][] // small table preview for sheets
  unfurled?: boolean // enrichment finished (ok or gave up)
  /** Synced from another device; the file itself never left that device. */
  remote?: boolean
}

/** One drawing object stored inside a document card. */
export interface DocumentStroke {
  id: string
  /** Optional for backward compatibility; old document ink is freehand. */
  kind?: Stroke['kind']
  points: XY[]
}

export interface DocumentText {
  id: string
  text: string
  x: number
  y: number
  fontSize?: number
  bold?: boolean
  italic?: boolean
  color?: string
}

export interface CanvasDocument {
  text: string
  strokes: DocumentStroke[]
  /** Freely positioned plain-text objects; unlike legacy `text`, these can overlap ink. */
  textItems?: DocumentText[]
  /** Display size on the board. */
  width?: number
  height?: number
  /** Local drawing space. It expands with the document instead of stretching ink. */
  canvasWidth?: number
  canvasHeight?: number
  /** Cached raster of the whole document for native multimodal MCP results. */
  snapshot?: string
}

export interface Card {
  id: string
  type: CardType
  content: string // text body, URL, or data URL for images/sketches
  title?: string
  meta?: CardMeta
  /** face = static preview (cheap); live = real iframe/video/3D (capped). */
  embedMode?: 'face' | 'live'
  poster?: string // captured snapshot for model/video faces
  addedBy: string // 'human' or an agent name ('claude', 'gemini', 'chatgpt', …)
  addedAt: number
  /** Last edit, for sync's last-write-wins merge. Absent means never edited. */
  updatedAt?: number
  accepted: boolean // human cards are born accepted; agent cards are provisional
  needs?: string // open handoff request ("transcribe this video")
  servedBy?: string // agent that fulfilled the request
  mergedInto?: string // tombstone left by merge_duplicates
  /** Present only for canvas cards; text and ink travel/sync as one entity. */
  document?: CanvasDocument
  /** User-chosen viewport for resizable interactive cards such as widgets. */
  displaySize?: { width: number; height: number }
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
  /** Normalized stylus pressure, when supplied by Pointer Events. */
  pressure?: number
}

/** On-canvas drawing objects: ink, shapes, and lightweight positioned text. */
export interface Stroke {
  id: string
  kind: 'draw' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text'
  points: XY[] // text: [top-left]; draw: polyline; line/rect/ellipse: [start, end]
  text?: string
  fontSize?: number
}

/** Content-anchored agent drawing: the page computes where it lands. */
export interface Annotation {
  id: string
  kind: 'box' | 'circle'
  cardIds: string[]
  note?: string
  by: string
}

/** A runtime tool an agent composed from existing vetted tools (register_tool). */
export interface AgentToolStep {
  tool: string
  args: Record<string, unknown> // string values may contain {input.field} placeholders
}
export interface AgentToolDef {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  steps: AgentToolStep[]
  by: string
  /** When it was taught, so sync can tell a re-add from a stale copy. */
  at?: number
}

export type ThemeName = 'mint' | 'paper' | 'slate' | 'ink'

export type CardStyle = 'pure' | 'cards'
export type Arrangement = 'clusters' | 'masonry' | 'grid' | 'row' | 'column' | 'tree'

export interface ViewPrefs {
  theme: ThemeName
  style: CardStyle
  arrangement: Arrangement
  /** pinned = the whiteboard feel: the tool rail is always on screen. */
  toolbar?: 'hidden' | 'pinned'
  /** Where the rail sits, as a fraction of the viewport so it survives resizes. */
  toolbarPos?: { x: number; y: number }
}

export type EngineStatus = 'cold' | 'warming' | 'ready' | 'embedding' | 'organizing'

export interface ProvenanceFilter {
  mode: 'all' | 'mine' | 'accepted' | 'pending'
  hiddenAgents: string[]
}
