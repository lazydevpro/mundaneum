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

An agent can add a card, link two cards, label a cluster, merge duplicates,
flag a contradiction, ask another agent for help. It may **never** emit an x/y
coordinate. All geometry belongs to the page. **No tool in this codebase takes
or returns a coordinate — if you find one, that's a bug.**

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

## Tool surface (7 tools, over the real engine)

| Tool | Purpose | Annotations |
|---|---|---|
| `get_board` | One rich structural read: clusters, excerpts, links, orphans, open requests, pending review. Computes structure lazily on first read. | `readOnlyHint`, `untrustedContentHint` |
| `add_cards` | Batch contribution. Lands **provisional** (dashed) until the human accepts. | `untrustedContentHint` |
| `link_cards` | Batch relations, each with a `why`, signed. | |
| `label_clusters` | Name the page-computed communities. | |
| `merge_duplicates` | Collapse near-identical cards — only pairs the **page** has verified as near-duplicates. Registered **only while candidates exist**, unregistered otherwise (per Chrome's guidance on destructive tools). | `destructiveHint` |
| `ask_region` | Scoped question: returns only one cluster's / the lasso selection's cards. | `readOnlyHint`, `untrustedContentHint` |
| `request_help` | Mark a card as needing a capability another agent has — the handoff. | |

Every contribution is signed by *which* agent (`claude`, `gemini`, `chatgpt`,
`grok`, …) and rendered with that agent's mark. Provisional cards are dashed;
accept/reject on hover. Filter: mine only / accepted / pending / per-agent.

## Multi-agent paths

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
- **C — External Claude** via `@mcp-b/webmcp-local-relay`: add `#relay=1` to
  the URL with the local relay host running, and Claude Desktop / Claude Code
  joins the same board over MCP.

## Capture

Paste anything (text, URLs, images — big text dumps split into cards).
Drop any file. Double-click to write in place. **+** button: note, file,
sketch (pointer canvas), phone camera (QR opens the board's capture page; a
tiny 5-minute mail-slot on the worker hops photos to the big screen — not a
sync backend). Board id in the URL hash, state in IndexedDB. No accounts.

## Run it

```bash
npm install
npm run dev
```

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
