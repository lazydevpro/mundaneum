import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { boardUrl } from '../boardId'
import { useBoard } from '../store'
import { apiKey, proxyUrl, serviceBase, setApiKey, setProxyUrl, type ProviderId } from '../agents/config'
import { dropEndpoint, startPhonePolling, stopPhonePolling } from '../capture/phone'
import { disableSharing, enableSharing, isShared, useSync } from '../sync/sync'
import type { ModalKind } from './PlusMenu'

export function Modals({ kind, close }: { kind: ModalKind; close: () => void }) {
  if (!kind) return null
  return (
    <div
      className="modal-back"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      {kind === 'qr' && <QrModal />}
      {kind === 'sketch' && <SketchModal close={close} />}
      {kind === 'settings' && <SettingsModal close={close} />}
    </div>
  )
}

function QrModal() {
  const boardId = useBoard((s) => s.boardId)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const url = boardUrl(boardId, { capture: '1' })
  const bridged = Boolean(dropEndpoint(boardId))

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, url, { width: 208, margin: 1 })
    }
    startPhonePolling()
    return () => stopPhonePolling()
  }, [url])

  return (
    <div className="modal">
      <h3>Add from your phone</h3>
      <canvas ref={canvasRef} style={{ borderRadius: 10 }} />
      <p>
        Scan to open this board's camera on your phone — it can open the full
        board there too.
        {bridged
          ? ' Photos arrive here whenever you come back to this window.'
          : ' Deploy the worker (or set a proxy URL under agents…) to bridge photos to this screen.'}
      </p>
      <SharePanel />
    </div>
  )
}

/**
 * Sharing is opt-in per board: until this is switched on, nothing about the
 * board has ever left the device. Large files stay local by design — only the
 * board and its compressed images travel, which is what keeps this free.
 */
function SharePanel() {
  const boardId = useBoard((s) => s.boardId)
  const cards = useBoard((s) => s.cards)
  const syncState = useSync((s) => s.state)
  const syncDetail = useSync((s) => s.detail)
  const [shared, setShared] = useState(() => isShared(boardId))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const available = serviceBase() !== null
  const link = boardUrl(boardId)

  const localOnly = Object.values(cards).filter((c) => c.meta?.asset).length

  if (!available) {
    return (
      <p className="share-note">
        Sharing needs the worker — deploy it, or set a proxy URL under agents….
      </p>
    )
  }

  return (
    <div className="share-panel">
      {!shared ? (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await enableSharing()
              setShared(ok)
              setBusy(false)
            }}
          >
            {busy ? 'sharing…' : 'share this board'}
          </button>
          <p className="share-note">
            Opens this board to anyone with the link, on any device. Nothing has
            left this device yet.
          </p>
        </>
      ) : (
        <>
          <div className="share-link">
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(link)
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
          <p className="share-note">
            <span className={'live-dot' + (syncState === 'live' ? ' on' : '')} />{' '}
            {syncState === 'error' ? syncDetail : 'shared — ' + (syncDetail || 'syncing')}
            {localOnly > 0 && (
              <>
                <br />
                {localOnly} file{localOnly > 1 ? 's' : ''} (video, 3D, documents) stay on
                this device — their cards travel, the files don't.
              </>
            )}
          </p>
          <button
            className="quiet"
            onClick={() => {
              disableSharing()
              setShared(false)
            }}
          >
            stop sharing
          </button>
        </>
      )}
    </div>
  )
}

function SketchModal({ close }: { close: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    const scale = window.devicePixelRatio || 1
    canvas.width = 340 * scale
    canvas.height = 260 * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(document.body).color
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  return (
    <div className="modal">
      <h3>Sketch</h3>
      <canvas
        ref={canvasRef}
        className="sketch-canvas"
        style={{ width: 340, height: 260 }}
        onPointerDown={(e) => {
          drawing.current = true
          canvasRef.current!.setPointerCapture(e.pointerId)
          const ctx = canvasRef.current!.getContext('2d')!
          const p = pos(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = canvasRef.current!.getContext('2d')!
          const p = pos(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          dirty.current = true
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          className="quiet"
          onClick={() => {
            const c = canvasRef.current!
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
            dirty.current = false
          }}
        >
          clear
        </button>
        <button
          className="primary"
          onClick={() => {
            if (dirty.current) {
              // Composite onto the card background so it reads in both themes.
              const src = canvasRef.current!
              const out = document.createElement('canvas')
              out.width = src.width
              out.height = src.height
              const ctx = out.getContext('2d')!
              ctx.fillStyle = getComputedStyle(document.body).backgroundColor
              ctx.fillRect(0, 0, out.width, out.height)
              ctx.drawImage(src, 0, 0)
              useBoard.getState().addCards(
                [{ content: out.toDataURL('image/png'), type: 'sketch' }],
                'human',
              )
            }
            close()
          }}
        >
          add to board
        </button>
      </div>
    </div>
  )
}

function SettingsModal({ close }: { close: () => void }) {
  const [proxy, setProxy] = useState(proxyUrl() ?? '')
  const [keys, setKeys] = useState<Record<ProviderId, string>>({
    claude: apiKey('claude') ?? '',
    gemini: apiKey('gemini') ?? '',
    grok: apiKey('grok') ?? '',
  })

  return (
    <div className="modal" style={{ width: 360 }}>
      <h3>In-page agents (optional)</h3>
      <p>
        Agents in your browser — ChatGPT's browser, Chrome's built-in agent —
        connect through WebMCP automatically. <b>No keys needed for that.</b>
      </p>
      <p>
        Keys are only for summoning a crew from inside the page (Claude +
        Gemini + Grok working the board together). Point at a deployed worker
        proxy (keys stay server-side), or paste keys for local use — they live
        only in this browser's localStorage.
      </p>
      <div className="settings-grid">
        <label>
          proxy URL (recommended)
          <input
            type="text"
            placeholder="https://mundaneum-proxy.you.workers.dev"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
        </label>
        {(['claude', 'gemini', 'grok'] as ProviderId[]).map((p) => (
          <label key={p}>
            {p} API key (local only)
            <input
              type="password"
              placeholder="sk-…"
              value={keys[p]}
              onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <button
        className="primary"
        onClick={() => {
          setProxyUrl(proxy.trim())
          for (const p of ['claude', 'gemini', 'grok'] as ProviderId[]) {
            setApiKey(p, keys[p].trim())
          }
          close()
        }}
      >
        save
      </button>
    </div>
  )
}
