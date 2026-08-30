import { useEffect, useState } from 'react'
import { hashFlag } from './boardId'
import { loadBoard, useBoard } from './store'
import { warmEngine } from './engine/engine'
import { reapplyExtensions, registerBoardTools } from './mcp/tools'
import { startWebMcp, type WebMcpStatus } from './mcp/webmcp'
import { installPasteHandler } from './capture/ingest'
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
import { callTool } from './mcp/registry'
import { useActive } from './embed/active'
import { probeProxy } from './agents/config'
import { latestGraph, organize } from './engine/engine'

// Dev/demo handle: lets you poke the same tool surface agents use.
if (import.meta.env.DEV) {
  Object.assign(window as object, {
    __mundaneum: { useBoard, callTool, organize, latestGraph, useActive },
  })
}

export default function App() {
  const [modal, setModal] = useState<ModalKind>(null)
  const [webmcp, setWebmcp] = useState<WebMcpStatus>('unavailable')
  const loaded = useBoard((s) => s.loaded)
  const isCapture = hashFlag('capture') === '1'

  useEffect(() => {
    registerBoardTools()
    void loadBoard().then(() => {
      // Re-apply this board's agent-authored providers + tools before the
      // WebMCP surface is published, so they appear on it too.
      reapplyExtensions()
      // Tools registered in the top-level page, after state exists.
      setWebmcp(startWebMcp())
      maybeLoadRelay()
      // Migration: URL cards from before the provider registry (or added by
      // agents/tools without classification) get faces + enrichment now.
      {
        const s = useBoard.getState()
        for (const c of Object.values(s.cards)) {
          if (!/^https?:\/\//.test(c.content) || c.meta?.unfurled) continue
          const cls = classifyUrl(c.content)
          s.updateCard(c.id, {
            type: cls.type,
            meta: { ...cls.meta, ...c.meta },
          })
          enrichCard(c.id)
        }
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
