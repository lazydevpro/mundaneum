import type { XY } from '../types'
import { create } from 'zustand'
import { useBoard } from '../store'
import { classifyUrl } from '../embed/providers'
import { enrichCard } from '../embed/unfurl'
import { MAX_ASSET_BYTES, putAsset } from './assets'
import { parseDoc, parseSheet } from './filetypes'

/**
 * Capture: anything you can paste or drop becomes a card. URLs classify
 * through the provider registry (video/audio/social/article…); files route
 * by kind — media and models into the Blob asset store, sheets and docs
 * through lazy-loaded parsers so their text feeds clustering.
 */

const URL_RE = /^https?:\/\/\S+$/i

/** 3D drops wait on a human choice: interactive on-canvas, or a snapshot. */
interface PendingModel {
  file: File
  at?: XY
}
interface PendingModelState {
  queue: PendingModel[]
  push(p: PendingModel): void
  shift(): void
}
export const usePendingModels = create<PendingModelState>((set, get) => ({
  queue: [],
  push(p) {
    set({ queue: [...get().queue, p] })
  },
  shift() {
    set({ queue: get().queue.slice(1) })
  },
}))

export function ingestUrl(url: string, at?: XY): void {
  const c = classifyUrl(url)
  const store = useBoard.getState()
  const [card] = store.addCards(
    [{ content: url, type: c.type, meta: c.meta, at }],
    'human',
  )
  if (c.needsUnfurl) enrichCard(card.id)
}

/** Paragraph-split large dumps so a wall of paste becomes a pile of cards. */
export function ingestText(text: string, at?: XY): number {
  const trimmed = text.trim()
  if (!trimmed) return 0

  if (URL_RE.test(trimmed) && !/\s/.test(trimmed)) {
    ingestUrl(trimmed, at)
    return 1
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks = paragraphs.length > 2 ? paragraphs : [trimmed]
  let n = 0
  for (const p of chunks.slice(0, 80)) {
    if (URL_RE.test(p) && !/\s/.test(p)) ingestUrl(p, at)
    else useBoard.getState().addCards([{ content: p.slice(0, 4000), at }], 'human')
    n++
  }
  return n
}

const SHEET_RE = /\.(csv|tsv|xlsx|xls|ods)$/i
const DOC_RE = /\.(docx)$/i
const MODEL_RE = /\.(glb|gltf)$/i
const TEXTY_RE = /\.(md|txt|json|log|yml|yaml|toml)$/i
const HTML_RE = /\.html?$/i

export async function ingestFiles(files: FileList | File[], at?: XY): Promise<number> {
  const store = useBoard.getState()
  let n = 0
  for (const file of Array.from(files).slice(0, 24)) {
    try {
      if (file.size > MAX_ASSET_BYTES) {
        store.logActivity('human', 'skipped ' + file.name + ' — over ' + Math.round(MAX_ASSET_BYTES / 1e6) + ' MB')
        continue
      }

      if (file.type.startsWith('image/')) {
        const dataUrl = await compressImage(file)
        store.addCards([{ content: dataUrl, type: 'image', title: cleanName(file.name), at }], 'human')
        n++
      } else if (file.type.startsWith('video/')) {
        const asset = await putAsset(file)
        store.addCards(
          [{
            content: cleanName(file.name),
            type: 'video',
            title: cleanName(file.name),
            meta: { asset, filename: file.name, provider: 'file' },
            at,
          }],
          'human',
        )
        n++
      } else if (file.type.startsWith('audio/')) {
        const asset = await putAsset(file)
        store.addCards(
          [{
            content: cleanName(file.name),
            type: 'audio',
            title: cleanName(file.name),
            meta: { asset, filename: file.name, provider: 'file' },
            at,
          }],
          'human',
        )
        n++
      } else if (MODEL_RE.test(file.name)) {
        usePendingModels.getState().push({ file, at })
        n++
      } else if (SHEET_RE.test(file.name)) {
        const asset = await putAsset(file)
        const parsed = await parseSheet(file, file.name).catch(() => null)
        store.addCards(
          [{
            content: parsed?.textSample ?? file.name,
            type: 'sheet',
            title: cleanName(file.name),
            meta: { asset, filename: file.name, preview: parsed?.preview },
            at,
          }],
          'human',
        )
        n++
      } else if (DOC_RE.test(file.name)) {
        const asset = await putAsset(file)
        const parsed = await parseDoc(file).catch(() => null)
        store.addCards(
          [{
            content: parsed?.excerpt ?? file.name,
            type: 'doc',
            title: cleanName(file.name),
            meta: { asset, filename: file.name },
            at,
          }],
          'human',
        )
        n++
      } else if (file.type === 'application/pdf') {
        const asset = await putAsset(file)
        store.addCards(
          [{
            content: cleanName(file.name),
            type: 'doc',
            title: cleanName(file.name),
            meta: { asset, filename: file.name },
            at,
          }],
          'human',
        )
        n++
      } else if (HTML_RE.test(file.name)) {
        const text = await file.text()
        store.addCards(
          [{
            content: text.slice(0, 60000),
            type: 'widget',
            title: cleanName(file.name),
            meta: { filename: file.name },
            at,
          }],
          'human',
        )
        n++
      } else if (file.type.startsWith('text/') || TEXTY_RE.test(file.name)) {
        const text = await file.text()
        n += ingestText(text.slice(0, 20000), at)
      } else {
        store.addCards(
          [{
            content: file.name + ' (' + fmtSize(file.size) + ')',
            type: 'file',
            title: cleanName(file.name),
            meta: { filename: file.name },
            at,
          }],
          'human',
        )
        n++
      }
    } catch (err) {
      console.warn('ingest failed for', file.name, err)
    }
  }
  return n
}

/** Called by the model-choice dialog once the human picks a mode. */
export async function ingestModel(p: PendingModel, mode: 'live' | 'face'): Promise<void> {
  const asset = await putAsset(p.file)
  useBoard.getState().addCards(
    [{
      content: cleanName(p.file.name),
      type: 'model',
      title: cleanName(p.file.name),
      meta: { asset, filename: p.file.name },
      embedMode: mode,
      at: p.at,
    }],
    'human',
  )
}

function cleanName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 80)
}

function fmtSize(bytes: number): string {
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes > 1e3) return Math.round(bytes / 1e3) + ' KB'
  return bytes + ' B'
}

/** Keep IndexedDB sane: images stored as ~640px JPEG data URLs. */
export async function compressImage(file: File | Blob, max = 640): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** Global paste: works anywhere on the page except inside editors. */
export function installPasteHandler(): void {
  window.addEventListener('paste', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable]')) return
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length) {
      e.preventDefault()
      void ingestFiles(files)
      return
    }
    const text = e.clipboardData?.getData('text/plain')
    if (text) {
      e.preventDefault()
      ingestText(text)
    }
  })
}
