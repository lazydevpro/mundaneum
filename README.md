# Mundaneum

*Named for Paul Otlet's Mundaneum — Brussels, 1910: twelve million cross-linked
index cards in rooms of cabinets, the paper internet. Still an operating archive
in Mons, Belgium. This project borrows the name as lineage, with credit.*

An infinite board you dump raw material onto — pasted notes, links, photos,
sketches, half-thoughts. No folders, no markdown, no structure required at
capture time. Agents connect over **WebMCP** and do the organizing: they read
the board, link things, name clusters, merge duplicates, and add material of
their own.

## The one rule

> **Agents may contribute anything except position.**

An agent can add a card, link two cards, label a cluster, group things by
hand, merge duplicates, sketch a diagram, draw a circle round an argument,
ask for a different arrangement, ask another agent for help — and it can
extend the board itself: teach it a platform it has never seen, or compose a
new tool and publish it to the surface other agents read.

What it may **never** do is emit an x/y coordinate. All geometry belongs to
the page. **No tool in this codebase takes or returns a coordinate — if you
find one, that's a bug.**

That single constraint is what makes the rest safe to hand over. Agents are
trusted with meaning precisely because they can't wreck the layout.

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

## Tool surface (14 tools, over the real engine)

**Read and contribute**

| Tool | Purpose | Annotations |
|---|---|---|
| `get_board` | One rich structural read: selected cards first (including native images for selected document canvases), then clusters, excerpts, links, orphans, open requests, and pending review. | `readOnlyHint`, `untrustedContentHint` |
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

**Extend the board itself**

| Tool | Purpose | Annotations |
|---|---|---|
| `add_provider` | Teach this board a platform it didn't ship with. Give it a host pattern and an embed template and Pinterest, Bandcamp, or anything else becomes a live embed — at runtime, no redeploy. | |
| `register_tool` | Compose a **new tool** out of existing vetted ones, with its own name, description, and input schema. It joins the WebMCP surface immediately and every later agent sees it. | |

The last two are the point: an agent that finds the board can't do something
doesn't file a feature request, it adds the capability and carries on. Both are
per-board, live in the page, and are listed in the WebMCP panel with a remove
button — the human can always take a capability back.

Every contribution is signed by *which* agent (`claude`, `gemini`, `chatgpt`,
`grok`, …) and rendered with that agent's mark. Provisional cards are dashed;
accept/reject on hover. Filter: mine only / accepted / pending / per-agent.

## Multi-agent paths

**The core experience needs no API keys.** WebMCP is bring-your-own-agent:
the page registers tools; the agent already in your browser calls them. Keys
exist only for the optional in-page crew (path A) — the one way to get three
vendors working the same board simultaneously, and a video-capable Gemini
standing by to serve handoffs.

- **A — In-page agents.** A small agent loop in the page (Claude / Gemini /
  Grok) drives the same internal registry the WebMCP tools wrap. Backed by a
  Cloudflare Worker proxy (`worker/`) with routes `/anthropic`, `/gemini`,
  `/xai`, keys server-side. Tool execution never leaves the browser.
  Capability routing that's actually true: **video → Gemini** (only major
  model with native video + YouTube URL input), **live social → Grok**
  (xAI owns the source), **orchestration → Claude** (most mature MCP client —
  no exclusive data, and we say so).
- **B — ChatGPT desktop** (the judged path). Open the deployed URL in
  ChatGPT's built-in browser; the WebMCP tools appear with zero setup.
- **C — Classic MCP**, for every client that doesn't speak WebMCP. Share a
  board and it gets an MCP endpoint at `/mcp/<boardId>` (the WebMCP panel
  shows the URL with a copy button). Point Claude Desktop, Claude Code, or
  Codex at it and they work the same board as the browser — same tools, same
  provenance, changes appearing in every open tab on the next sync:

  ```json
  { "mcpServers": { "mundaneum": { "url": "https://…/mcp/<boardId>" } } }
  ```

  It speaks JSON-RPC over plain HTTP POST (Streamable HTTP, stateless — no
  session, no SSE) and runs *inside* the board's Durable Object, which is
  single-threaded, so each tool call is an atomic read-modify-write.

  Ten of the tools live there: `get_board`, `get_canvas_document`, `add_cards`, `link_cards`,
  `group_cards`, `ask_region`, `annotate_cards`, `draw_sketch`,
  `set_arrangement`, `request_help`. The ones that need the page's engine —
  clustering by embedding, near-duplicate detection — are deliberately
  absent rather than faked, because that work belongs to the open board.

  `#relay=1` still loads `@mcp-b/webmcp-local-relay` if you'd rather bridge
  an unshared, local-only board to a desktop MCP client.

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
edit it in place. A pen mode (+ menu → draw) inks freehand strokes, lines,
boxes, and ovals straight onto the canvas; ink is pure geometry and is never
exposed to agents.

Click a card to focus it; Shift-click adds or removes cards from that focus
set. `get_board` returns the selected cards first with full content so agents
scope work to them on large boards. Every card also exposes a small **ID**
button on hover/selection for copying its exact id into a prompt. Document
canvas ink is exposed as a visual snapshot (suited to handwriting and math),
while its typed layer remains searchable text.
Document canvases and interactive widget cards have a bottom-right resize
handle; their chosen viewport dimensions persist with the card.

## Run it

```bash
npm install
npm run dev
```

`npm test` covers the sync merge — the one place two devices can silently
lose each other's work. `npm run typecheck` checks the app and worker together.

WebMCP needs Chrome 149+ with an origin-trial token — or locally:
`chrome://flags/#enable-webmcp-testing`. The status dot (bottom-left) is green
when the tools are registered.

Deploying: set `VITE_ORIGIN_TRIAL_TOKEN` (bound to the **exact** origin —
wildcards don't cover `*.vercel.app`/`*.netlify.app`/`*.pages.dev`) and
`VITE_PROXY_URL`. Deploy the worker with `npm run worker:deploy` after
`wrangler secret put ANTHROPIC_API_KEY` (and `GEMINI_API_KEY`, `XAI_API_KEY`).

### Silent-failure traps this code already respects

- `document.modelContext`, **not** `navigator.modelContext` (removed in
  Chrome 150; most tutorials still teach the old name).
- Tools registered by JavaScript in the **top-level page** — iframe tools are
  invisible to agents, same-origin included.
- No declarative HTML-form tools (unsupported in ChatGPT).
- Dynamic registration via `AbortController` + re-sync on board changes.

## Demo notes

Seed a ~120-card research pile from the **+** menu on an empty board. Demo at
120–150 cards, not 300 — force layouts hairball past ~200. (A bigger board
still loads fine as a scale proof; it's just not the hero shot.)

## License

MIT — see [LICENSE](LICENSE).
