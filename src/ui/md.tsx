import { Fragment, type ReactNode } from 'react'
import { useBoard } from '../store'

/**
 * Markdown-lite for notes: task lists (interactive), headings, bullets,
 * bold / italic / code. Built as React nodes — no HTML injection surface.
 */

const TASK_RE = /^\s*[-*]\s\[([ xX])\]\s(.*)$/

export function hasMd(text: string): boolean {
  return /(^|\n)\s*([-*]\s|#{1,3}\s)|\*\*|`/.test(text)
}

function inline(text: string, key = 0): ReactNode {
  // code first, then bold, then italic — one pass each, no nesting ambition
  const parts: ReactNode[] = []
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g)
  tokens.forEach((t, i) => {
    if (!t) return
    const k = key * 1000 + i
    if (t.startsWith('`') && t.endsWith('`')) {
      parts.push(<code key={k}>{t.slice(1, -1)}</code>)
    } else if (t.startsWith('**') && t.endsWith('**')) {
      parts.push(<b key={k}>{t.slice(2, -2)}</b>)
    } else if (t.startsWith('*') && t.endsWith('*') && t.length > 2) {
      parts.push(<i key={k}>{t.slice(1, -1)}</i>)
    } else {
      parts.push(<Fragment key={k}>{t}</Fragment>)
    }
  })
  return parts
}

export function MdText({ text, cardId }: { text: string; cardId: string }) {
  const lines = text.split('\n')

  const toggleTask = (lineIdx: number) => {
    const card = useBoard.getState().cards[cardId]
    if (!card) return
    const ls = card.content.split('\n')
    const m = ls[lineIdx]?.match(TASK_RE)
    if (!m) return
    ls[lineIdx] = ls[lineIdx].replace(
      /\[([ xX])\]/,
      m[1] === ' ' ? '[x]' : '[ ]',
    )
    useBoard.getState().updateCard(cardId, { content: ls.join('\n') })
  }

  return (
    <div className="md">
      {lines.map((line, i) => {
        const task = line.match(TASK_RE)
        if (task) {
          const done = task[1] !== ' '
          return (
            <div
              key={i}
              className={'md-task' + (done ? ' done' : '')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                toggleTask(i)
              }}
            >
              <span className="box">{done ? '✓' : ''}</span>
              <span>{inline(task[2], i)}</span>
            </div>
          )
        }
        const h = line.match(/^(#{1,3})\s+(.*)$/)
        if (h) {
          return (
            <div key={i} className="md-h">
              {inline(h[2], i)}
            </div>
          )
        }
        const b = line.match(/^\s*[-*]\s+(.*)$/)
        if (b) {
          return (
            <div key={i} className="md-li">
              <span className="dot">·</span>
              <span>{inline(b[1], i)}</span>
            </div>
          )
        }
        return <div key={i}>{line ? inline(line, i) : ' '}</div>
      })}
    </div>
  )
}
