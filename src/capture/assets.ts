import { createStore, del, get, set } from 'idb-keyval'
import { newId } from '../boardId'

/**
 * Blob asset store — dropped videos, 3D models, sheets, docs live here as
 * Blobs (IndexedDB handles them natively), NOT as data URLs in card content.
 * Cards reference them as meta.asset ids; object URLs are minted per session.
 */

const store = createStore('mundaneum-assets', 'assets')
const urls = new Map<string, string>()

export const MAX_ASSET_BYTES = 120_000_000 // ~120 MB; beyond this, refuse politely

export async function putAsset(blob: Blob): Promise<string> {
  const id = newId('as')
  await set(id, blob, store)
  return id
}

export async function getAsset(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, store)
}

/** Session-cached object URL for rendering. */
export async function assetUrl(id: string): Promise<string | null> {
  const hit = urls.get(id)
  if (hit) return hit
  const blob = await getAsset(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}

export async function deleteAsset(id: string): Promise<void> {
  const url = urls.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urls.delete(id)
  }
  await del(id, store)
}
