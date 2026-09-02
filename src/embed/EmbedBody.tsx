import { useEffect, useRef, useState } from 'react'
import type { Card } from '../types'
import { useBoard } from '../store'
import { assetUrl } from '../capture/assets'
import { hostOf } from './providers'
import { liveHeight } from './dims'
import { useActive } from './active'
import { openViewer } from '../ui/viewer'
import { Icon } from '../ui/icons'

/**
 * The body of every URL/file card. Facade pattern throughout: a static face
 * costs nothing; the real iframe/<video>/3D viewer exists only while the
 * card is one of the few live embeds (see active.ts).
 */

export function useAssetUrlOf(card: Card): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const asset = card.meta?.asset
  useEffect(() => {
    let gone = false
    if (asset) {
      void assetUrl(asset).then((u) => {
        if (!gone) setUrl(u)
      })
    }
    return () => {
      gone = true
    }
  }, [asset])
  return url
}

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms'
const IFRAME_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write'

export function EmbedBody({ card }: { card: Card }) {
  const live = useActive((s) => s.live.includes(card.id))
  const activate = useActive((s) => s.activate)
  const deactivate = useActive((s) => s.deactivate)
  const activateCard = () => {
    // Live is an intent, not just an in-memory runtime slot. Persist it so a
    // refresh restores an interactive widget instead of falling back to its face.
    if (card.embedMode !== 'live') useBoard.getState().updateCard(card.id, { embedMode: 'live' })
    activate(card.id)
  }

  // "live" persists as intent on the card (3D chosen interactive); the
  // runtime cap still decides whether it is actually running right now.
  const wantsLive = card.embedMode === 'live'
  useEffect(() => {
    if (wantsLive) activate(card.id)
  }, [wantsLive, card.id, activate])

  if (live) {
    return (
      <LiveEmbed
        card={card}
        onClose={() => {
          deactivate(card.id)
          if (card.embedMode === 'live' && card.type !== 'model') {
            useBoard.getState().updateCard(card.id, { embedMode: 'face' })
          }
        }}
      />
    )
  }
  return <Face card={card} onActivate={activateCard} />
}

// ---------------------------------------------------------------- faces

function Face({ card, onActivate }: { card: Card; onActivate: () => void }) {
  const meta = card.meta ?? {}
  const isUrl = /^https?:\/\//.test(card.content)

  switch (card.type) {
    case 'video':
      return (
        <VideoFace card={card} onActivate={onActivate} />
      )
    case 'audio':
      return (
        <button className="embed-face audio-face" onClick={onActivate} title="play">
          <span className="badge"><Icon name="note" size={14} /></span>
          <span className="face-text">
            <span className="title">{card.title ?? meta.title ?? card.content}</span>
            <SourceLink card={card} fallback={isUrl ? undefined : 'audio'} />
          </span>
          <span className="play-mini"><Icon name="play" size={10} /></span>
        </button>
      )
    case 'social':
      return (
        <button className="embed-face" onClick={meta.embedUrl ? onActivate : () => window.open(card.content, '_blank')}>
          {meta.image && <img className="face-img" src={meta.image} alt="" draggable={false} referrerPolicy="no-referrer" />}
          {meta.description && <span className="quote">{meta.description}</span>}
          <span className="face-foot">
            <SourceLink card={card} />
            {meta.embedUrl && <span className="play-mini"><Icon name="play" size={10} /></span>}
          </span>
        </button>
      )
    case 'link':
      return <ArticleFace card={card} onActivate={onActivate} />
    case 'sheet':
      return (
        <button className="embed-face" onClick={() => openViewer(card)} title="open sheet">
          {meta.preview?.length ? (
            <table className="mini-table">
              <tbody>
                {meta.preview.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span className="quote">{card.content.slice(0, 160)}</span>
          )}
          <span className="face-foot">
            <span className="host"><Icon name="grid" size={11} /> {meta.filename ?? 'sheet'}</span>
          </span>
        </button>
      )
    case 'doc':
      return (
        <button className="embed-face" onClick={() => openViewer(card)} title="open document">
          <span className="doc-excerpt">{card.content.slice(0, 220)}</span>
          <span className="face-foot">
            <span className="host"><Icon name="lines" size={11} /> {meta.filename ?? 'document'}</span>
          </span>
        </button>
      )
    case 'widget':
      return (
        <button className="embed-face" onClick={onActivate} title="run widget (sandboxed)">
          <span className="widget-face">
            <span className="badge"><Icon name="code" size={14} /></span>
            <span className="face-text">
              <span className="title">{card.title ?? 'widget'}</span>
              <span className="host">{meta.description ?? 'interactive — click to run'}</span>
            </span>
            <span className="play-mini"><Icon name="play" size={10} /></span>
          </span>
        </button>
      )
    case 'model':
      return <ModelFace card={card} onActivate={onActivate} />
    default:
      return (
        <span className="face-text">
          <span className="title"><Icon name="file" size={12} /> {card.title ?? 'file'}</span>
          <span className="host">{card.content}</span>
        </span>
      )
  }
}

function VideoFace({ card, onActivate }: { card: Card; onActivate: () => void }) {
  const meta = card.meta ?? {}
  const url = useAssetUrlOf(card)
  const face = card.poster ?? meta.image

  // Dropped video files: capture a first-frame poster once, quietly.
  useEffect(() => {
    if (face || !url) return
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.src = url
    v.addEventListener('loadeddata', () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2)
    })
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = Math.round((320 * v.videoHeight) / (v.videoWidth || 320)) || 180
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      useBoard.getState().updateCard(card.id, { poster: c.toDataURL('image/jpeg', 0.7) })
      v.src = ''
    })
  }, [face, url, card.id])

  return (
    <button className="embed-face" onClick={onActivate} title="play">
      <span className="video-thumb">
        {face ? <img className="face-img" src={face} alt="" draggable={false} referrerPolicy="no-referrer" /> : <span className="thumb-blank" />}
        <span className="play-big"><Icon name="play" size={28} /></span>
      </span>
      <span className="face-foot">
        <span className="title">{card.title ?? meta.title ?? 'video'}</span>
        <SourceLink card={card} fallback={meta.filename ? 'file' : undefined} />
      </span>
    </button>
  )
}

/**
 * The host label, as a real link when there's a URL behind it. Embedding can
 * always fail for reasons outside this app (owner-disabled embeds, age gates,
 * a signed-out browser), so every media card keeps a one-click way to watch
 * it at the source.
 */
function SourceLink({ card, fallback }: { card: Card; fallback?: string }) {
  const meta = card.meta ?? {}
  const isUrl = /^https?:\/\//.test(card.content)
  const label = meta.site ?? fallback ?? (isUrl ? hostOf(card.content) : card.type)
  if (!isUrl) return <span className="host">{label}</span>
  return (
    <a
      className="host"
      href={card.content}
      target="_blank"
      rel="noreferrer noopener"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      title={'open on ' + label}
    >
      {label} ↗
    </a>
  )
}

function ArticleFace({ card, onActivate }: { card: Card; onActivate: () => void }) {
  const meta = card.meta ?? {}
  return (
    <div className="embed-face article-face">
      {meta.image && <img className="face-img" src={meta.image} alt="" draggable={false} referrerPolicy="no-referrer" />}
      <span className="title">{card.title ?? meta.title ?? card.content}</span>
      {meta.description && <span className="desc">{meta.description}</span>}
      <span className="face-foot">
        <a
          className="host"
          href={card.content}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {meta.site ?? hostOf(card.content)} ↗
        </a>
        <span className="face-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            title="ask an agent to summarize this"
            onClick={() =>
              useBoard.getState().requestHelp(
                card.id,
                'read this link and add a short summary card',
                'human',
              )
            }
          >
            <Icon name="sparkle" size={11} />
          </button>
          <button
            title="embed the live page"
            onClick={() => {
              if (!meta.embedUrl) {
                useBoard.getState().updateCard(card.id, {
                  meta: { ...meta, embedUrl: card.content },
                })
              }
              onActivate()
            }}
          >
            <Icon name="play" size={11} />
          </button>
        </span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- live

function LiveEmbed({ card, onClose }: { card: Card; onClose: () => void }) {
  const h = liveHeight(card)
  // Some videos disallow embedding outright (age-restricted, owner-disabled),
  // so a live player always offers a way out to the source.
  const sourceUrl = /^https?:\/\//.test(card.content) ? card.content : null
  return (
    <div className="live-embed">
      <div className="live-strip">
        <span className="title">{card.title ?? card.meta?.title ?? card.meta?.filename ?? ''}</span>
        {sourceUrl && (
          <a
            className="live-open"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            onPointerDown={(e) => e.stopPropagation()}
            title={'open on ' + (card.meta?.site ?? 'the source site')}
          >
            open ↗
          </a>
        )}
        <button
          className="live-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="back to preview"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="live-body" style={{ height: h }} onPointerDown={(e) => e.stopPropagation()}>
        <LiveInner card={card} />
      </div>
    </div>
  )
}

function LiveInner({ card }: { card: Card }) {
  const url = useAssetUrlOf(card)
  const meta = card.meta ?? {}

  if (card.type === 'model') return <ModelLive card={card} />

  if (card.type === 'widget') {
    // Agent-authored code runs in a locked sandbox: allow-scripts ONLY.
    // No allow-same-origin means an opaque origin — no cookies, no storage,
    // no parent DOM, no board. That jail is what makes plugins safe here.
    return (
      <iframe
        srcDoc={card.content}
        title={card.title ?? 'widget'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    )
  }

  if (meta.asset) {
    if (!url) return <span className="host">loading…</span>
    if (card.type === 'video') return <video src={url} controls playsInline style={{ width: '100%', height: '100%' }} />
    if (card.type === 'audio') return <audio src={url} controls style={{ width: '100%' }} />
  }

  const src = meta.embedUrl ?? card.content
  // Fixed-size provider widgets must never show scrollbars; live article
  // pages are real pages and keep theirs.
  const isWidget = card.type === 'video' || card.type === 'audio' || card.type === 'social'
  /**
   * A player from a known provider (built-in or one an agent taught us via
   * add_provider) embeds unsandboxed — exactly as every site on the web
   * embeds YouTube/Spotify. Sandboxing strips their session and YouTube
   * answers with a bot check instead of the video. Arbitrary page URLs
   * ("embed live" on an article) stay sandboxed, and agent-authored widget
   * code above keeps the hardest jail of all.
   */
  const trustedProvider = Boolean(meta.provider) && meta.provider !== 'article' && Boolean(meta.embedUrl)
  return (
    <ProviderFrame
      card={card}
      src={src}
      sandboxed={!trustedProvider}
      noScroll={isWidget}
    />
  )
}

// ------------------------------------------------------- when embeds fail

const STALL_MS = 6000

/**
 * How far we can honestly get at detecting a broken embed.
 *
 * A cross-origin frame that answers with a sign-in wall, an age gate or a bot
 * check is a *successful* load as far as the DOM is concerned: status 200,
 * `load` fires, and same-origin policy hides what is actually rendered. There
 * is no event for "the site refused you". So this does not pretend to know.
 * It reports two things it can stand behind — the frame errored, or it never
 * finished loading at all — and otherwise just notes that the embed has had
 * long enough to start, which is when offering a way out becomes useful.
 */
function useEmbedTrouble(src: string) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const [waited, setWaited] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setErrored(false)
    setWaited(false)
    const t = setTimeout(() => setWaited(true), STALL_MS)
    return () => clearTimeout(t)
  }, [src])

  return {
    onLoad: () => setLoaded(true),
    onError: () => setErrored(true),
    /** Certain: nothing is there to look at. */
    dead: errored || (waited && !loaded),
    /** Loaded, but whether it works is unknowable from out here. */
    unverifiable: waited && loaded,
  }
}

function sourceOf(card: Card): { url: string | null; site: string } {
  const url = /^https?:\/\//.test(card.content) ? card.content : null
  return { url, site: card.meta?.site ?? (url ? hostOf(url) : 'the source') }
}

function ProviderFrame({
  card,
  src,
  sandboxed,
  noScroll,
}: {
  card: Card
  src: string
  sandboxed: boolean
  noScroll: boolean
}) {
  const trouble = useEmbedTrouble(src)
  if (trouble.dead) return <EmbedFallback card={card} />
  return (
    <div className="frame-wrap">
      <iframe
        src={src}
        title={card.title ?? src}
        {...(sandboxed ? { sandbox: IFRAME_SANDBOX } : {})}
        allow={IFRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        scrolling={noScroll ? 'no' : undefined}
        onLoad={trouble.onLoad}
        onError={trouble.onError}
      />
      {trouble.unverifiable && <EmbedHint card={card} />}
    </div>
  )
}

/** The frame is definitively empty — say so, and keep the material reachable. */
function EmbedFallback({ card }: { card: Card }) {
  const { url, site } = sourceOf(card)
  const poster = card.poster ?? card.meta?.image
  return (
    <div className="embed-blocked">
      {poster && (
        <img className="blocked-poster" src={poster} alt="" draggable={false} referrerPolicy="no-referrer" />
      )}
      <span className="blocked-title">{site} didn’t load here</span>
      <span className="blocked-sub">
        The site may refuse embedding, or want a sign-in.
      </span>
      {url && (
        <a
          className="blocked-open"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Open on {site} ↗
        </a>
      )}
    </div>
  )
}

/**
 * The embed loaded and may well be fine — so this never covers it. It is a
 * thin line offering the source, for the case the page cannot see: a wall
 * rendered inside the frame.
 */
function EmbedHint({ card }: { card: Card }) {
  const [dismissed, setDismissed] = useState(false)
  const { url, site } = sourceOf(card)
  if (dismissed || !url) return null
  return (
    <div className="embed-hint" onPointerDown={(e) => e.stopPropagation()}>
      <span>Not playing?</span>
      <a href={url} target="_blank" rel="noreferrer noopener">
        open on {site} ↗
      </a>
      <button onClick={() => setDismissed(true)} title="dismiss">
        <Icon name="x" size={9} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 3D

let modelViewerLoaded: Promise<unknown> | null = null
function loadModelViewer() {
  modelViewerLoaded ??= import('@google/model-viewer')
  return modelViewerLoaded
}

interface ModelViewerEl extends HTMLElement {
  toDataURL(type?: string): string
  toBlob(opts?: { mimeType?: string; idealAspect?: boolean }): Promise<Blob>
}

function ModelFace({ card, onActivate }: { card: Card; onActivate: () => void }) {
  const url = useAssetUrlOf(card)
  const hostRef = useRef<HTMLSpanElement>(null)
  const generating = !card.poster && !!url

  // Snapshot mode without a poster yet: render the viewer IN PLACE (visible —
  // model-viewer suspends rendering while offscreen), grab a frame once it
  // loads, then swap to the still image. Runs exactly once per card.
  useEffect(() => {
    if (!generating || !hostRef.current) return
    let disposed = false
    let mv: ModelViewerEl | null = null
    void loadModelViewer().then(() => {
      if (disposed || !hostRef.current) return
      mv = document.createElement('model-viewer') as ModelViewerEl
      mv.setAttribute('src', url!)
      mv.setAttribute('camera-orbit', '35deg 70deg auto')
      mv.setAttribute('interaction-prompt', 'none')
      mv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
      const capture = () => {
        if (disposed || !mv) return
        // toBlob re-renders synchronously before reading — toDataURL reads a
        // possibly-cleared WebGL buffer and comes back blank.
        void mv
          .toBlob({ mimeType: 'image/png', idealAspect: false })
          .then((blob) => {
            // toBlob re-renders before reading, so the frame is real; only
            // guard against a corrupt/empty file. Simple models ARE tiny.
            if (blob.size < 400) throw new Error('empty capture')
            return new Promise<string>((res, rej) => {
              const r = new FileReader()
              r.onload = () => res(r.result as string)
              r.onerror = rej
              r.readAsDataURL(blob)
            })
          })
          .then((poster) => {
            if (!disposed) useBoard.getState().updateCard(card.id, { poster })
          })
          .catch(() => {
            /* viewer stays as the face — still usable */
          })
      }
      mv.addEventListener('load', () => setTimeout(capture, 600))
      hostRef.current.appendChild(mv)
      setTimeout(capture, 7000) // belt and braces if 'load' never fires
    })
    return () => {
      disposed = true
      mv?.remove()
    }
  }, [generating, url, card.id])

  return (
    <button className="embed-face" onClick={onActivate} title="view in 3D">
      <span className="video-thumb model-thumb" ref={hostRef}>
        {card.poster ? (
          <img className="face-img" src={card.poster} alt="" draggable={false} />
        ) : (
          <span className="thumb-blank model-blank">◇</span>
        )}
        {!generating && <span className="play-big">3D</span>}
      </span>
      <span className="face-foot">
        <span className="title">{card.title ?? 'model'}</span>
        <span className="host">{card.meta?.filename ?? 'glb'}</span>
      </span>
    </button>
  )
}

function ModelLive({ card }: { card: Card }) {
  const url = useAssetUrlOf(card)
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void loadModelViewer().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready || !url || !ref.current) return
    const mv = document.createElement('model-viewer')
    mv.setAttribute('src', url)
    mv.setAttribute('camera-controls', '')
    mv.setAttribute('auto-rotate', '')
    mv.setAttribute('shadow-intensity', '0.6')
    mv.style.cssText = 'width:100%;height:100%;background:transparent'
    ref.current.appendChild(mv)
    return () => mv.remove()
  }, [ready, url])

  return <div ref={ref} style={{ width: '100%', height: '100%' }}>{!ready && <span className="host">loading 3D…</span>}</div>
}
