import { hashFlag } from '../boardId'

/**
 * Path C: external Claude (Desktop / Code) joining the same board through
 * @mcp-b/webmcp-local-relay — bridges this page's WebMCP tools over MCP.
 *
 * Opt-in via #relay=1 so the default page stays dependency-free. The relay
 * script only matters when the local relay host is also running; if the CDN
 * load fails we say so and move on.
 */
export function maybeLoadRelay(): void {
  if (hashFlag('relay') !== '1') return
  const s = document.createElement('script')
  s.src = 'https://unpkg.com/@mcp-b/webmcp-local-relay'
  s.async = true
  s.onload = () => console.info('webmcp-local-relay loaded — external MCP clients can join this board')
  s.onerror = () =>
    console.warn(
      'webmcp-local-relay failed to load. Install and run the local relay host, ' +
        'or drop the #relay=1 flag.',
    )
  document.head.appendChild(s)
}
