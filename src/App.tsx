import { useEffect, useState } from 'react'
import { hashFlag, watchBoardChanges } from './boardId'
import { loadBoard, useBoard } from './store'
import { warmEngine } from './engine/engine'
import { reapplyExtensions, registerBoardTools } from './mcp/tools'
import { startWebMcp, type WebMcpStatus } from './mcp/webmcp'
import { installPasteHandler } from './capture/ingest'
import { installPhoneDropListener } from './capture/phone'
import { joinIfShared, startSync } from './sync/sync'
import { startLocalSync } from './sync/local'
import { Canvas } from './ui/Canvas'
import { AgentBar } from './ui/AgentBar'
import { Brand, CornerControls, StatusLine } from './ui/Chrome'
import { PlusMenu, type ModalKind } from './ui/PlusMenu'
import { Modals } from './ui/Modals'
import { ModelChoiceModal, ViewerModal } from './ui/Viewers'
import { PenBar } from './ui/ink'
import { CapturePage } from './ui/CapturePage'
import { maybeLoadRelay } from './mcp/relay'
import { classifyUrl } from './embed/providers'
import { enrichCard } from './embed/unfurl'
import { allTools, applicableTools, callTool } from './mcp/registry'
import { useActive } from './embed/active'
import { probeProxy } from './agents/config'
import { latestGraph, organize } from './engine/engine'

// Dev/demo handle: lets you poke the same tool surface agents use.
if (import.meta.env.DEV) {
  Object.assign(window as object, {
    __mundaneum: {
      useBoard, callTool, organize, latestGraph, useActive,
      allTools, applicableTools, startWebMcp,
    },
  })
}

export default function App() {
  const [modal, setModal] = useState<ModalKind>(null)
  const [webmcp, setWebmcp] = useState<WebMcpStatus>('unavailable')
  const loaded = useBoard((s) => s.loaded)
  const theme = useBoard((s) => s.prefs.theme)
  const isCapture = hashFlag('capture') === '1'

  // The palette lives on the root element so every layer — canvas, modals,
  // and the sandboxed sketch/model captures — reads the same tokens.
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? 'mint'
  }, [theme])

  useEffect(() => {
    watchBoardChanges(useBoard.getState().boardId)
    registerBoardTools()
    void loadBoard().then(() => {
      // Re-apply this board's agent-authored providers + tools before the
      // WebMCP surface is published, so they appear on it too.
      reapplyExtensions()
      // Widgets created before live intent was persisted should still restore
      // as interactive cards after a refresh. Closing one explicitly changes
      // its mode to "face" and therefore remains respected on later loads.
      {
        const s = useBoard.getState()
        for (const c of Object.values(s.cards)) {
          if (c.type === 'widget' && !c.embedMode) s.updateCard(c.id, { embedMode: 'live' })
        }
      }
      // Tools registered in the top-level page, after state exists.
      setWebmcp(startWebMcp())
      maybeLoadRelay()
      // Migration: URL cards get re-classified against the CURRENT provider
      // table on every load. Provider definitions change (a better embed URL,
      // a platform an agent taught this board), and a stored embedUrl would
      // otherwise rot — cards keep their unfurled title/image/description.
      {
        const s = useBoard.getState()
        for (const c of Object.values(s.cards)) {
          if (!/^https?:\/\//.test(c.content)) continue
          const cls = classifyUrl(c.content)
          // Re-classify only when it's an upgrade. A card synced from a device
          // that knows a platform this one doesn't still carries a working
          // embed; overwriting it with our "just an article" guess would
          // quietly downgrade someone else's card.
          const upgrade = Boolean(cls.meta.embedUrl) || !c.meta?.provider
          if (!upgrade) continue
          s.updateCard(c.id, {
            type: c.meta?.unfurled ? c.type : cls.type,
            meta: { ...c.meta, ...cls.meta },
          })
          if (!c.meta?.unfurled) enrichCard(c.id)
        }
      }
      // Only after the local board is in memory — starting earlier would
      // push an empty document over the shared copy.
      if (!isCapture) {
        startLocalSync() // other tabs on this machine, no server involved
        startSync()
        void joinIfShared() // opening a shared link brings the board with it
      }
      // Structure is derived state: boards that were organized before get
      // their clusters (and reattached labels) recomputed quietly.
      const s = useBoard.getState()
      if (!isCapture && s.labels.length && Object.keys(s.cards).length >= 4) {
        void organize()
      }
    })
    if (!isCapture) {
      probeProxy()
      installPasteHandler()
      installPhoneDropListener()
      // Pre-warm the embedding model so the first organize is instant.
      void warmEngine()
    }
  }, [isCapture])

  if (isCapture) return loaded ? <CapturePage /> : null
  if (!loaded) return null

  return (
    <>
      <Canvas />
      <Brand />
      <CornerControls />
      <StatusLine webmcp={webmcp} />
      <PlusMenu openModal={setModal} />
      <AgentBar onNeedsSetup={() => setModal('settings')} />
      <Modals kind={modal} close={() => setModal(null)} />
      <PenBar />
      <ViewerModal />
      <ModelChoiceModal />
    </>
  )
}
