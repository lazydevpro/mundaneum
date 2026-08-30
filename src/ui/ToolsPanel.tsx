import { useState } from 'react'
import { allTools } from '../mcp/registry'
import type { WebMcpStatus } from '../mcp/webmcp'
import { Icon } from './icons'

/**
 * The bottom-left WebMCP pill + panel: what this page exposes to agents,
 * stated in the open — including the one rule.
 */

const TRY_ASKING = [
  '"Organize this board."',
  '"Group the pricing cards and name the clusters."',
  '"Add a widget that charts the equipment costs."',
  '"Sketch a floor-plan idea and put it near the space notes."',
  '"What does the permits cluster say?"',
]

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
  const tools = allTools()
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
          <b>The one rule:</b> agents may contribute anything except position. They add,
          link, group, label, annotate, sketch, and arrange by intent — the page computes
          every coordinate. No tool takes or returns one.
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
            return (
              <div key={t.name} className={'tool-card' + (dormant ? ' dormant' : '')}>
                <span className="tool-name">{t.name}</span>
                <span className="tool-desc">
                  {dormant
                    ? 'Appears when the page has verified near-duplicates.'
                    : firstSentence(t.description)}
                </span>
                <span className="tool-badges">
                  {t.annotations?.readOnlyHint && <em>read-only</em>}
                  {t.annotations?.destructiveHint && <em>destructive</em>}
                  {t.applicable && <em>dynamic</em>}
                </span>
              </div>
            )
          })}
        </div>

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
