import type { CardType, XY } from '../types'
import { useBoard } from '../store'

/**
 * Capture: anything you can paste or drop becomes cards. No structure asked
 * for at capture time — organizing is the agents' job.
 */

const URL_RE = /^https?:\/\/\S+$/i
const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)/i

export function classifyUrl(url: string): CardType {
  return VIDEO_HOSTS.test(url) ? 'video' : 'link'
}

/** Paragraph-split large dumps so a wall of paste becomes a pile of cards. */
export function ingestText(text: string, at?: XY): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  const store = useBoard.getState()

  if (URL_RE.test(trimmed)) {
    store.addCards([{ content: trimmed, type: classifyUrl(trimmed) }], 'human')
    return 1
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const items =
    paragraphs.length > 2
      ? paragraphs.map((p) => lineToItem(p))
      : [lineToItem(trimmed)]
  store.addCards(items.slice(0, 80).map((it) => ({ ...it, at })), 'human')
  return items.length
}

function lineToItem(p: string): { content: string; type: CardType } {
  const single = p.split('\n').length === 1 && URL_RE.test(p)
  return single
    ? { content: p, type: classifyUrl(p) }
    : { content: p.slice(0, 4000), type: 'text' }
}

export async function ingestFiles(files: FileList | File[], at?: XY): Promise<number> {
  const store = useBoard.getState()
  let n = 0
  for (const file of Array.from(files).slice(0, 24)) {
    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await compressImage(file)
        store.addCards([{ content: dataUrl, type: 'image', title: cleanName(file.name), at }], 'human')
        n++
      } else if (
        file.type.startsWith('text/') ||
        /\.(md|txt|csv|json)$/i.test(file.name)
      ) {
        const text = await file.text()
        n += ingestText(text.slice(0, 20000), at)
      } else if (file.type.startsWith('video/')) {
        store.addCards(
          [{ content: file.name, type: 'video', title: cleanName(file.name), at }],
          'human',
        )
        n++
      } else {
        store.addCards(
          [{ content: file.name + ' (' + fmtSize(file.size) + ')', type: 'file', title: cleanName(file.name), at }],
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
