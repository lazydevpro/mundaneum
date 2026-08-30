import { useEffect, useState } from 'react'
import { useViewer } from './viewer'
import { usePendingModels, ingestModel } from '../capture/ingest'
import { getAsset, assetUrl } from '../capture/assets'
import { parseDoc, parseSheet } from '../capture/filetypes'

/** Full-view modal for sheets, docs, and PDFs, plus the 3D drop choice. */

export function ViewerModal() {
  const card = useViewer((s) => s.card)
  const close = useViewer((s) => s.close)
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'sheet'; rows: string[][] }
    | { kind: 'doc'; html: string }
    | { kind: 'pdf'; url: string }
    | { kind: 'error'; msg: string }
  >({ kind: 'loading' })

  useEffect(() => {
    if (!card) return
    setState({ kind: 'loading' })
    const asset = card.meta?.asset
    if (!asset) {
      setState({ kind: 'error', msg: 'no stored file for this card' })
      return
    }
    let gone = false
    void (async () => {
      try {
        if (card.type === 'sheet') {
          const blob = await getAsset(asset)
          if (!blob) throw new Error('asset missing')
          const parsed = await parseSheet(blob, card.meta?.filename ?? 'sheet.csv')
          if (!gone) setState({ kind: 'sheet', rows: parsed.rows })
        } else if (/\.pdf$/i.test(card.meta?.filename ?? '')) {
          const url = await assetUrl(asset)
          if (!url) throw new Error('asset missing')
          if (!gone) setState({ kind: 'pdf', url })
        } else {
          const blob = await getAsset(asset)
          if (!blob) throw new Error('asset missing')
          const parsed = await parseDoc(blob)
          if (!gone) setState({ kind: 'doc', html: parsed.html })
        }
      } catch (err) {
        if (!gone) setState({ kind: 'error', msg: String(err) })
      }
    })()
    return () => {
      gone = true
    }
  }, [card])

  if (!card) return null

  return (
    <div
      className="modal-back"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal viewer-modal">
        <h3>{card.title ?? card.meta?.filename ?? 'file'}</h3>
        <div className="viewer-body">
          {state.kind === 'loading' && <p>opening…</p>}
          {state.kind === 'error' && <p>{state.msg}</p>}
          {state.kind === 'sheet' && (
            <div className="viewer-scroll">
              <table className="big-table">
                <tbody>
                  {state.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state.kind === 'doc' && (
            <iframe
              className="viewer-frame"
              sandbox=""
              title="document"
              srcDoc={
                '<style>body{font-family:Georgia,serif;line-height:1.6;padding:20px;max-width:640px;margin:auto;color:#222;background:#fffdf7}img{max-width:100%}</style>' +
                state.html
              }
            />
          )}
          {state.kind === 'pdf' && <iframe className="viewer-frame" src={state.url} title="pdf" />}
        </div>
        <button className="primary" onClick={close}>
          done
        </button>
      </div>
    </div>
  )
}

export function ModelChoiceModal() {
  const queue = usePendingModels((s) => s.queue)
  const shift = usePendingModels((s) => s.shift)
  const pending = queue[0]
  if (!pending) return null

  const choose = (mode: 'live' | 'face') => {
    void ingestModel(pending, mode)
    shift()
  }

  return (
    <div className="modal-back">
      <div className="modal">
        <h3>3D model</h3>
        <p>
          <b>{pending.file.name}</b> — put it on the board as a spinning
          interactive model, or a lightweight snapshot image? (You can switch later.)
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="primary" onClick={() => choose('face')}>
            snapshot image
          </button>
          <button className="primary" onClick={() => choose('live')}>
            interactive 3D
          </button>
        </div>
      </div>
    </div>
  )
}
