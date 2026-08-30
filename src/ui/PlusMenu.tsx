import { useEffect, useRef, useState } from 'react'
import { liveCards, useBoard } from '../store'
import { organize } from '../engine/engine'
import { ingestFiles } from '../capture/ingest'
import { seedDemo } from '../demo/seed'
import { useInk } from './ink'
import { Icon } from './icons'

/**
 * The one button. Everything else you can already do by pasting, dropping,
 * or double-clicking — this menu is for what needs a hand: sketch, phone
 * camera, file picker, organize. "Stacks" let you keep only the tools you use.
 */

export type ModalKind = 'qr' | 'sketch' | 'settings' | null

interface Item {
  key: string
  label: string
  hint?: string
  always?: boolean
}

const ITEMS: Item[] = [
  { key: 'note', label: 'note', hint: 'or double-click', always: true },
  { key: 'file', label: 'file', hint: 'or drop it' },
  { key: 'draw', label: 'draw', hint: 'ink + shapes' },
  { key: 'phone', label: 'phone camera' },
  { key: 'organize', label: 'organize', hint: 'the page decides', always: true },
]

const STACKS: Record<string, string[]> = {
  everything: ['note', 'file', 'draw', 'phone', 'organize'],
  researcher: ['note', 'file', 'phone', 'organize'],
  whiteboard: ['note', 'draw', 'organize'],
}

function loadStack(): string[] {
  try {
    const raw = localStorage.getItem('mundaneum:stack')
    if (raw) {
      // 'sketch' became 'draw' when ink moved onto the canvas
      return (JSON.parse(raw) as string[]).map((k) => (k === 'sketch' ? 'draw' : k))
    }
  } catch {
    /* default below */
  }
  return STACKS.everything
}

export function PlusMenu({ openModal }: { openModal: (m: ModalKind) => void }) {
  const [open, setOpen] = useState(false)
  const [customize, setCustomize] = useState(false)
  const [stack, setStack] = useState<string[]>(loadStack)
  const empty = useBoard((s) => liveCards(s.cards).length === 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('mundaneum:stack', JSON.stringify(stack))
  }, [stack])

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setCustomize(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const act = (key: string) => {
    setOpen(false)
    switch (key) {
      case 'note':
        window.dispatchEvent(new CustomEvent('mundaneum:new-note'))
        return
      case 'file':
        fileRef.current?.click()
        return
      case 'draw':
        useInk.getState().setPen(true)
        return
      case 'phone':
        openModal('qr')
        return
      case 'organize':
        void organize()
        return
    }
  }

  const shown = ITEMS.filter((i) => i.always || stack.includes(i.key))

  return (
    <div className="chrome plus-wrap" ref={wrapRef}>
      <button
        className={'plus' + (open ? ' open' : '')}
        onClick={() => {
          setOpen(!open)
          setCustomize(false)
        }}
        aria-label="add"
      >
        <Icon name="plus" size={19} />
      </button>

      {open && (
        <div className="plus-items">
          {customize ? (
            <>
              {Object.keys(STACKS).map((name) => (
                <button
                  key={name}
                  className="plus-item"
                  onClick={() => {
                    setStack(STACKS[name])
                    // the whiteboard preset pins the tool rail on screen
                    useBoard.getState().setPrefs({
                      toolbar: name === 'whiteboard' ? 'pinned' : 'hidden',
                    })
                    setCustomize(false)
                  }}
                >
                  {name} <span className="k">stack</span>
                </button>
              ))}
              {ITEMS.filter((i) => !i.always).map((i) => (
                <button
                  key={i.key}
                  className="plus-item"
                  onClick={() =>
                    setStack((s) =>
                      s.includes(i.key) ? s.filter((k) => k !== i.key) : [...s, i.key],
                    )
                  }
                >
                  <Icon name={stack.includes(i.key) ? 'boxcheck' : 'boxempty'} size={13} /> {i.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {empty && (
                <button
                  className="plus-item"
                  style={{ borderColor: 'var(--accent)' }}
                  onClick={() => {
                    setOpen(false)
                    seedDemo()
                  }}
                >
                  seed a demo pile <span className="k">~120 cards</span>
                </button>
              )}
              {shown.map((i, idx) => (
                <button
                  key={i.key}
                  className="plus-item"
                  style={{ animationDelay: idx * 0.03 + 's' }}
                  onClick={() => act(i.key)}
                >
                  {i.label} {i.hint && <span className="k">{i.hint}</span>}
                </button>
              ))}
              <button className="plus-item" onClick={() => setCustomize(true)}>
                <span className="k">build your stack…</span>
              </button>
              <button className="plus-item" onClick={() => { setOpen(false); openModal('settings') }}>
                <span className="k">agents…</span>
              </button>
            </>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void ingestFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
