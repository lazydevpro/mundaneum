import { useEffect, useState } from 'react'
import { hashFlag } from './boardId'
import { loadBoard, useBoard } from './store'
import { warmEngine } from './engine/engine'
import { registerBoardTools } from './mcp/tools'
import { startWebMcp, type WebMcpStatus } from './mcp/webmcp'
import { installPasteHandler } from './capture/ingest'
import { Canvas } from './ui/Canvas'
import { AgentBar } from './ui/AgentBar'
import { Brand, CornerControls, StatusLine } from './ui/Chrome'
import { PlusMenu, type ModalKind } from './ui/PlusMenu'
import { Modals } from './ui/Modals'
import { CapturePage } from './ui/CapturePage'
import { maybeLoadRelay } from './mcp/relay'
import { callTool } from './mcp/registry'
import { latestGraph, organize } from './engine/engine'

// Dev/demo handle: lets you poke the same tool surface agents use.
if (import.meta.env.DEV) {
  Object.assign(window as object, {
    __mundaneum: { useBoard, callTool, organize, latestGraph },
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
      // Tools registered in the top-level page, after state exists.
      setWebmcp(startWebMcp())
      maybeLoadRelay()
      // Structure is derived state: boards that were organized before get
      // their clusters (and reattached labels) recomputed quietly.
      const s = useBoard.getState()
      if (!isCapture && s.labels.length && Object.keys(s.cards).length >= 4) {
        void organize()
      }
    })
    if (!isCapture) {
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
    </>
  )
}
