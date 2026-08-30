import { useRef, useState } from 'react'
import { useBoard } from '../store'
import { compressImage } from '../capture/ingest'
import { sendToDesktop } from '../capture/phone'

/**
 * What the QR opens on a phone: one big camera button. Photos try to hop to
 * the desktop through the worker's drop slot; either way they land on this
 * device's copy of the board.
 */
export function CapturePage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sent, setSent] = useState(0)
  const [note, setNote] = useState('')

  return (
    <div className="capture-page">
      <div>
        <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 22 }}>
          Mundaneum
        </div>
        <div style={{ color: 'var(--faint)', fontSize: 12 }}>camera capture</div>
      </div>
      <button className="big" onClick={() => inputRef.current?.click()} aria-label="take photo">
        ◉
      </button>
      <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
        {sent > 0 ? sent + ' photo' + (sent > 1 ? 's' : '') + ' captured' : 'tap to shoot'}
        {note && (
          <>
            <br />
            <span style={{ color: 'var(--faint)' }}>{note}</span>
          </>
        )}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          e.target.value = ''
          const dataUrl = await compressImage(file, 800)
          const store = useBoard.getState()
          store.addCards([{ content: dataUrl, type: 'image', title: 'from phone' }], 'human')
          setSent((n) => n + 1)
          const hopped = await sendToDesktop(store.boardId, dataUrl).catch(() => false)
          setNote(hopped ? 'sent to the big screen' : 'saved on this device')
        }}
      />
    </div>
  )
}
