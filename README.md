# Mundaneum

[**Live demo**](https://mundaneum.lazydevpro.workers.dev) ·
[**WebMCP Challenge**](https://webmcp.devpost.com/) ·
[**MIT licensed**](LICENSE)

*Named for Paul Otlet's Mundaneum — Brussels, 1910: twelve million cross-linked
index cards in rooms of cabinets, the paper internet. Still an operating archive
in Mons, Belgium. This project borrows the name as lineage, with credit.*

An infinite board you dump raw material onto — pasted notes, links, photos,
sketches, half-thoughts. No folders, no markdown, no structure required at
capture time. Agents connect over **WebMCP** and do the organizing: they read
the board, link things, name clusters, merge duplicates, and add material of
their own.

## WebMCP Challenge submission

Mundaneum is an agent-native research canvas built for the 2026 WebMCP
Challenge. It turns a spatial board into a set of structured browser tools,
letting ChatGPT understand and act on the board without screen-coordinate
guessing or a separate integration server.

### Why WebMCP fits

A visual research board contains structure that a screenshot alone cannot
reliably express: exact card contents and ids, explicit links, groups,
selection state, document text, and the actions the interface safely permits.
WebMCP exposes that meaning directly from the live page. The result is a
collaborative workflow in which the person controls attention and placement,
while the agent can work with the board's real data and commands.

### What people and agents do together

- People capture notes, links, files, images, documents, widgets, drawings,
  and handwritten work on one infinite canvas.
- A click focuses a card and Shift-click builds a multi-selection. Selected
  cards are returned first and in full; selected drawings are supplied as an
  image so a multimodal agent can read sketches, handwriting, and equations.
- Agents summarize, connect, group, annotate, deduplicate, and add material.
  They may request an arrangement, but the page alone computes positions and
  prevents overlaps.
- People can copy a card's exact id into a prompt, making targeted work fast
  even on a large board.

### How WebMCP is implemented

The app registers imperative tools on `document.modelContext`, publishes a JSON
Schema for every input, and sends each call through the same board actions used
by the visible interface. Registration is refreshed as board capabilities
change and cleaned up with `AbortController`. An abridged version of the bridge:

```js
const controller = new AbortController()

await document.modelContext.registerTool(
  {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    execute: async (input) => {
      const result = await callTool(def.name, input ?? {}, 'agent')
      return JSON.parse(result)
    },
  },
  { signal: controller.signal },
)
```

The production implementation lives in
[`src/mcp/webmcp.ts`](src/mcp/webmcp.ts), with tool schemas and behavior in
[`src/mcp/tools.ts`](src/mcp/tools.ts). The dated commit
history records the WebMCP implementation and challenge work completed during
the submission period.



## What the page owns (the engine)

The page does the O(n²) work so agents spend their context on judgment:

1. **Embed** every card in-browser — transformers.js, `Xenova/all-MiniLM-L6-v2`
   quantized (~23 MB), **WASM backend in a Web Worker** (deliberately not
   WebGPU: for MiniLM-class models, GPU dispatch overhead exceeds the
   computation, and WASM has no shader-compile cold start). Pre-warmed on load.
2. **Similarity graph** — exhaustive pairwise cosine. At 150 cards that's
   ~11,000 comparisons no model can do in-context.
3. **Communities** — Louvain (`graphology-communities-louvain`).
4. **Layout** — d3-force with **each community pinned to its own
   `forceX`/`forceY` anchor** on a coarse grid. Force handles only
   intra-cluster spacing and collision. This anchoring is mandatory, not an
   optimization: a plain force layout optimizes edge length, not community
   cohesion, and scatters a labelled cluster across the board.
5. **Metrics** — orphans (degree 0).
6. **Spatial index** — rbush, so lasso selection and region queries scale.

Agents get back a compressed structural summary, never the raw board.

## Tool surface (15 built-in tools, over the real engine)

**Read and contribute**

| Tool | Purpose | Annotations |
|---|---|---|
| `get_board` | One rich structural read: selected cards first, a cropped image for selected direct drawings, then clusters, excerpts, links, orphans, open requests, and pending review. Selected document canvases include their visual image. | `readOnlyHint`, `untrustedContentHint` |
| `get_board_image` | Return the entire board as one native visual image, including cards, links, document canvases, annotations, and direct ink/text drawings. | `readOnlyHint`, `untrustedContentHint` |
| `get_canvas_document` | Return an expandable document canvas as one native image so vision models read typed text, handwriting, shapes, equations, and layout together. Documents reuse the board pen, shape, arrow, eraser, and undo tools. | `readOnlyHint`, `untrustedContentHint` |
| `add_cards` | Batch contribution — text, links, images, or a whole HTML widget. Lands **provisional** (dashed) until the human accepts. | `untrustedContentHint` |
| `ask_region` | Scoped question: returns only one cluster's / the lasso selection's cards. | `readOnlyHint`, `untrustedContentHint` |
| `request_help` | Mark a card as needing a capability another agent has — the handoff. | |

**Give it structure**

| Tool | Purpose | Annotations |
|---|---|---|
| `link_cards` | Batch relations, each with a `why`, signed. | |
| `label_clusters` | Name the page-computed communities. | |
| `group_cards` | Declare that a set of cards belongs together under a name — manual grouping without touching a single coordinate. | |
| `merge_duplicates` | Collapse near-identical cards — only pairs the **page** has verified as near-duplicates. Registered **only while candidates exist**, unregistered otherwise (per Chrome's guidance on destructive tools). | `destructiveHint` |
| `set_arrangement` | Ask for a different projection — `clusters`, `masonry`, `grid`, `row`, `column`, `tree`. You express intent; the page computes every position. | |

**Draw**

| Tool | Purpose | Annotations |
|---|---|---|
| `draw_sketch` | Freehand on the agent's *own* 100×75 canvas — polylines, lines, boxes, ellipses, arrows. The page renders it to a sketch card and decides where it lands. | |
| `annotate_cards` | Draw a box or circle around named cards. Content-anchored: the drawing follows them wherever the page puts them. | |

**Experimental extension tools**

| Tool | Purpose | Annotations |
|---|---|---|
| `add_provider` | Teach this board a platform it didn't ship with. Give it a host pattern and an embed template and Pinterest, Bandcamp, or anything else becomes a live embed — at runtime, no redeploy. | |
| `register_tool` | Compose a **new tool** out of existing vetted ones, with its own name, description, and input schema. It joins the WebMCP surface immediately and every later agent sees it. | |

These two extension tools are prototypes and are not part of the tested
hackathon workflow. They are retained for future exploration of user-reviewed,
per-board capabilities and may change before being considered production-ready.

Tool contributions carry a caller label and render as provisional cards until
the person accepts or rejects them.

## Agent connection paths

**The tested WebMCP experience needs no API keys.** The page registers tools
for the agent already available in the browser.

- **ChatGPT desktop** (the judged path). Open the deployed URL in
  ChatGPT's built-in browser; the WebMCP tools appear with zero setup.
- **Classic MCP**, for clients that do not speak WebMCP. Share a
  board and it gets an MCP endpoint at `/mcp/<boardId>` (the WebMCP panel
  shows the URL with a copy button). Point a compatible client at it to use
  the same board tools as the browser:

  ```json
  { "mcpServers": { "mundaneum": { "url": "https://…/mcp/<boardId>" } } }
  ```

  It speaks JSON-RPC over plain HTTP POST (Streamable HTTP, stateless — no
  session, no SSE) and runs *inside* the board's Durable Object, which is
  single-threaded, so each tool call is an atomic read-modify-write.

  Eleven of the tools live there: `get_board`, `get_board_image`, `get_canvas_document`, `add_cards`, `link_cards`,
  `group_cards`, `ask_region`, `annotate_cards`, `draw_sketch`,
  `set_arrangement`, `request_help`. The ones that need the page's engine —
  clustering by embedding, near-duplicate detection — are deliberately
  absent rather than faked, because that work belongs to the open board.

  `#relay=1` still loads `@mcp-b/webmcp-local-relay` if you'd rather bridge
  an unshared, local-only board to a desktop MCP client.

### Future scope: optional in-page AI

The repository contains early code for running third-party AI providers inside
the app through a server-side proxy. That path and its credential setup have
not yet been fully tested, are not required for the WebMCP submission, and are
not documented as a supported feature. Future work may turn it into an
explicitly enabled, provider-agnostic experience after security, failure-mode,
and end-to-end testing.

## Capture — anything is a card

Paste anything (text, URLs, images — big text dumps split into cards).
Drop any file. Double-click to write in place. **+** button: note, document
canvas (typed text and handwriting kept as one agent-readable card), file,
sketch (pointer canvas), phone camera (QR opens the board's capture page; a
tiny 5-minute mail-slot on the worker hops photos to the big screen — not a
sync backend). Board id in the URL hash, state in IndexedDB. No accounts.
Every new card first tries the intended landing point, then searches outward
for the nearest empty footprint, including the dimensions of resized cards.

**Links** classify through a provider registry (`src/embed/providers.ts` — one
table, deliberately the seam a future plugin system would attach to):
YouTube, Vimeo, Loom, Spotify, Apple Music, SoundCloud, Instagram, TikTok,
X (quote card), Figma, Google Maps, direct media URLs — everything else
becomes an article card with a social preview (title · description · image ·
favicon-line), unfurled progressively: provider-native oEmbed → noembed.com →
the worker's `/unfurl` (og: tags via HTMLRewriter, edge-cached). Article
cards carry two hover actions: **✦ summarize** (files a `request_help` any
connected agent can serve) and **▶ embed live**.

**Files** route by kind: images compress to data URLs; video/audio/3D go into
a Blob **asset store** (IndexedDB, not data URLs); CSV parses natively;
XLSX/DOCX parse through lazy-loaded chunks (SheetJS / mammoth never touch the
main bundle); PDFs open in the built-in viewer. Sheets and docs contribute
their parsed text to clustering, so a spreadsheet lands near the notes it
belongs with. 3D drops (`.glb`/`.gltf`) ask: **interactive on the canvas**
(model-viewer, lazy 1MB chunk) **or a snapshot image** (rendered once
offscreen, then torn down).

### Heavy embeds: the facade pattern

Every embed renders as a static **face** — thumbnail, mini-table, quote,
excerpt — which costs nothing. Clicking activates the real thing (YouTube
player, Spotify widget, `<video>`, 3D viewer) and at most **3 embeds are live
at once** (LRU — activating a fourth returns the oldest to its face). That's
what lets "everything is embeddable" coexist with a 150-card canvas. Unfurled
titles and parsed excerpts also feed the embedding engine, so rich cards
cluster by meaning, not by URL.

## Look & arrange

Default view is **pure** — no card frames, just the material floating on the
canvas, like a reference wall (switch to framed **cards** in the ◐ view
menu). Arrangements, all computed by the page: **clusters** (anchored force
layout), **masonry** (the tiled-gallery wall, ordered so semantic neighbors
stay adjacent), **grid**, **one row**, **one column**. Provisional agent
material stays visibly provisional in every style — that's information, not
decoration.

Notes support markdown-lite — headings, bullets, `code`, **bold**, and
interactive `- [ ]` task lists (click to toggle). Double-click a note to
edit it in place. A pen mode (+ menu → draw) adds pressure-sensitive freehand
strokes, lines, boxes, ovals, arrows, and positioned handwriting-style text
straight onto the canvas. Ink stays editable geometry; it reaches an agent
only when the person intentionally selects it or requests a whole-board PNG.

Click a card to focus it; Shift-click adds or removes cards from that focus
set. `get_board` returns the selected cards first with full content so agents
scope work to them on large boards. Every card also exposes a small **ID**
button on hover/selection for copying its exact id into a prompt. Document
canvas ink is exposed as a visual snapshot (suited to handwriting and math),
while its typed layer remains searchable text.
Document canvases and interactive widget cards have a bottom-right resize
handle; their chosen viewport dimensions persist with the card.

## Run it

### Prerequisites

- A current Node.js LTS release and npm.
- For agent interaction: the ChatGPT in-app browser, or Chrome 149+ with
  `chrome://flags/#enable-webmcp-testing` enabled for local development.

### Local development

```bash
git clone https://github.com/lazydevpro/mundaneum.git
cd mundaneum
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). The core board
and local WebMCP tools need no account, API key, or backend configuration.

For an origin-trial build, copy [`.env.example`](.env.example) to `.env` and
set `VITE_ORIGIN_TRIAL_TOKEN`. Set `VITE_PROXY_URL` only when the frontend and
Cloudflare Worker run on different origins.

### Verify

```bash
npm test
npm run typecheck
npm run build
```

The tests cover board synchronization, placement, arrangements, document
canvases, pointer handling, board-image export, and embed providers.

The WebMCP status dot in the bottom-left is green when browser tools are
registered.

### Deploy to Cloudflare

The included [`wrangler.toml`](wrangler.toml) deploys the built app and its
collaboration Durable Object as one Worker:

```bash
npm install
npm run build
npx wrangler login
npm run worker:deploy
```

The origin-trial token must match the **exact** production origin. Wildcards do
not cover `*.workers.dev`, `*.pages.dev`, `*.vercel.app`, or `*.netlify.app`.
No third-party model API keys are required for the tested WebMCP path.

### Silent-failure traps this code already respects

- `document.modelContext`, **not** `navigator.modelContext` (removed in
  Chrome 150; most tutorials still teach the old name).
- Tools registered by JavaScript in the **top-level page** — iframe tools are
  invisible to agents, same-origin included.
- No declarative HTML-form tools (unsupported in ChatGPT).
- Dynamic registration via `AbortController` + re-sync on board changes.

## Development disclosure

Mundaneum was developed with AI-assisted engineering using **ChatGPT**,
**OpenAI Codex**, and **Anthropic Claude Code** for research, implementation,
debugging, testing, and documentation. Product direction, review, acceptance,
and submission decisions remain the responsibility of the project maintainer.

## License

Mundaneum is open-source software released under the [MIT License](LICENSE).
Third-party packages and assets retain their respective licenses.
