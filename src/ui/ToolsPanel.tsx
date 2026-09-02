import { useEffect, useReducer, useState } from 'react'
import { allTools, onToolsChanged, removeTool } from '../mcp/registry'
import { removeRuntimeProvider } from '../embed/providers'
import { serviceBase } from '../agents/config'
import { isShared } from '../sync/sync'
import { FILE_SUPPORT, PLATFORM_SUPPORT, type CapabilityGroup } from '../embed/capabilities'
import { useBoard } from '../store'
import type { WebMcpStatus } from '../mcp/webmcp'
import { Icon } from './icons'

/**
 * The bottom-left WebMCP pill + panel: what this page exposes to agents,
 * stated in the open — including the one rule.
 */

const TRY_ASKING = [
  '"Show me the whole board as an image."',
  '"Organize this board."',
  '"Group the pricing cards and name the clusters."',
  '"Add a widget that charts the equipment costs."',
  '"Sketch a floor-plan idea and put it near the space notes."',
  '"What does the permits cluster say?"',
]

/** A copyable block of config — the thing you actually paste somewhere. */
function Snippet({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="snippet">
      {label && <span className="snippet-label">{label}</span>}
      <pre>{text}</pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

type ClientKind = 'claude-code' | 'codex' | 'other'

const FIRST_PROMPT =
  'You are connected to a Mundaneum research board over MCP. Call get_board first to see what is on it, ' +
  'then help me make sense of it: group related cards with group_cards, connect ones that belong together ' +
  'using link_cards (each with a why), and add anything obviously missing with add_cards. ' +
  'Sign your work with your own name. You contribute meaning — the board decides where everything goes.'

/**
 * The same board over classic MCP, for clients that don't speak WebMCP.
 * Shows the exact config to paste, per client, plus a first prompt — a URL
 * on its own isn't setup instructions.
 */
function McpEndpoint() {
  const boardId = useBoard((s) => s.boardId)
  const [client, setClient] = useState<ClientKind>('claude-code')
  const base = serviceBase()
  if (base === null) return null
  const url = (base || location.origin) + '/mcp/' + boardId
  const shared = isShared(boardId)

  const config: Record<ClientKind, { label: string; where: string; text: string }> = {
    'claude-code': {
      label: 'Claude Code',
      where: 'run this in your terminal',
      text: 'claude mcp add --transport http mundaneum ' + url,
    },
    codex: {
      label: 'Codex',
      where: 'add to ~/.codex/config.toml',
      text:
        '[features]\nexperimental_use_rmcp_client = true\n\n' +
        '[mcp_servers.mundaneum]\nurl = "' + url + '"',
    },
    other: {
      label: 'Others',
      where: 'Claude Desktop, Cursor, and most clients take this JSON',
      text: JSON.stringify(
        { mcpServers: { mundaneum: { type: 'http', url } } },
        null,
        2,
      ),
    },
  }
  const chosen = config[client]

  return (
    <div className="tools-caps">
      <span className="head-line">Connect an agent — classic MCP</span>
      <p className="tools-sub" style={{ marginTop: 0 }}>
        {shared ? (
          <>
            Anything that speaks MCP can work this same board — Claude Code, Codex,
            Claude Desktop — alongside the WebMCP agents in this page.
          </>
        ) : (
          <>
            <b>Share this board first.</b> The endpoint serves the shared copy, not this
            tab, so it stays empty until you press Share above.
          </>
        )}
      </p>

      <div className="client-tabs">
        {(Object.keys(config) as ClientKind[]).map((k) => (
          <button
            key={k}
            className={'client-tab' + (client === k ? ' on' : '')}
            onClick={() => setClient(k)}
          >
            {config[k].label}
          </button>
        ))}
      </div>

      <Snippet label={chosen.where} text={chosen.text} />
      <Snippet label="then say" text={FIRST_PROMPT} />

      <p className="tools-sub" style={{ marginTop: 0 }}>
        If a client only speaks stdio, wrap it:{' '}
        <code>npx -y mcp-remote {url}</code>
      </p>
    </div>
  )
}

function CapabilitySection({ head, groups }: { head: string; groups: CapabilityGroup[] }) {
  return (
    <div className="tools-caps">
      <span className="head-line">{head}</span>
      {groups.map((g) => (
        <div key={g.label} className="cap-row">
          <span className="cap-label">{g.label}</span>
          <span className="cap-items">
            {g.items.map((i) => (
              <em key={i}>{i}</em>
            ))}
            {g.note && <span className="cap-note">{g.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function firstSentence(text: string, max = 110): string {
  const dot = text.indexOf('. ')
  const s = dot > 20 ? text.slice(0, dot + 1) : text
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function WebMcpPill({ status }: { status: WebMcpStatus }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="webmcp-pill" onClick={() => setOpen(true)} title="tools this page exposes to agents">
        <span className={'live-dot' + (status === 'live' ? ' on' : '')} />
        WebMCP
      </button>
      {open && <ToolsModal status={status} close={() => setOpen(false)} />}
    </>
  )
}

function ToolsModal({ status, close }: { status: WebMcpStatus; close: () => void }) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onToolsChanged(bump), [])
  const agentProviders = useBoard((s) => s.agentProviders)
  const tools = allTools()
  const removeAgentTool = (name: string) => {
    removeTool(name)
    useBoard.getState().removeAgentExtension('tool', name)
  }
  const removeProvider = (key: string) => {
    removeRuntimeProvider(key)
    useBoard.getState().removeAgentExtension('provider', key)
    bump()
  }
  return (
    <div
      className="modal-back"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal tools-modal">
        <div className="tools-head">
          <div>
            <h3>WebMCP</h3>
            <p className="tools-sub">
              Structured tools this page exposes to AI agents — ChatGPT, Gemini in Chrome,
              or any WebMCP client that opens this board.
            </p>
          </div>
          <button className="tools-close" onClick={close} aria-label="close">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="tools-rule">
          <b>Agents contribute meaning.</b> They add cards, images, and widgets; link,
          group, and label; sketch and annotate; arrange the board; and even build new
          tools and teach it new platforms. The page arranges by default, and every
          action is signed by which agent made it.
        </div>

        <div className={'tools-status' + (status === 'live' ? ' on' : '')}>
          <span className={'live-dot' + (status === 'live' ? ' on' : '')} />
          {status === 'live' ? (
            <span>
              <b>Tools are registered.</b> Agents in this browser can see and use this board
              while the page is open.
            </span>
          ) : (
            <span>
              <b>No agent surface in this browser.</b> Open this page in ChatGPT desktop's
              browser, or Chrome 149+ with the WebMCP origin trial — the in-page agent crew
              works regardless.
            </span>
          )}
        </div>

        <div className="tools-grid">
          {tools.map((t) => {
            const dormant = t.applicable && !t.applicable()
            const agentMade = t.source === 'agent'
            return (
              <div key={t.name} className={'tool-card' + (dormant ? ' dormant' : '') + (agentMade ? ' agent-made' : '')}>
                <span className="tool-name">
                  {t.name}
                  {agentMade && (
                    <button
                      className="tool-remove"
                      title="remove this agent-built tool"
                      onClick={() => removeAgentTool(t.name)}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  )}
                </span>
                <span className="tool-desc">
                  {dormant
                    ? 'Appears when the page has verified near-duplicates.'
                    : firstSentence(t.description)}
                </span>
                <span className="tool-badges">
                  {t.annotations?.readOnlyHint && <em>read-only</em>}
                  {t.annotations?.destructiveHint && <em>destructive</em>}
                  {t.applicable && <em>dynamic</em>}
                  {agentMade && <em className="by-agent">built by {t.by}</em>}
                </span>
              </div>
            )
          })}
        </div>

        <McpEndpoint />

        <CapabilitySection
          head="What you can drop, paste, or link"
          groups={FILE_SUPPORT}
        />
        <CapabilitySection head="Links that become live embeds" groups={PLATFORM_SUPPORT} />

        {agentProviders.length > 0 && (
          <div className="tools-providers">
            <span className="head-line">Platforms agents taught this board</span>
            {agentProviders.map((p) => (
              <span key={p.key} className="provider-chip">
                {p.site}
                <button title="remove" onClick={() => removeProvider(p.key)}>
                  <Icon name="x" size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="tools-try">
          <span className="head-line">Try asking</span>
          {TRY_ASKING.map((q) => (
            <span key={q}>{q}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
