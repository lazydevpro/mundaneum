import type { Card } from '../types'

/**
 * One source of truth for card footprints — the layout engine's collision,
 * the spatial index, and CardView's CSS all read these numbers.
 */

export function cardWidth(card: Card): number {
  switch (card.type) {
    case 'text':
      return 224
    case 'image':
    case 'sketch':
      return 224
    case 'audio':
      return 280
    case 'file':
      return 224
    case 'canvas':
      return card.document?.width ?? 360
    case 'widget':
      return card.displaySize?.width ?? 320
    default:
      return 320 // link, video, social, sheet, doc, model
  }
}

export function liveHeight(card: Card): number {
  switch (card.type) {
    case 'video':
      return 180 // 16:9 of 320
    case 'audio':
      switch (card.meta?.provider) {
        case 'spotify': return 152
        case 'applemusic': return 175
        case 'soundcloud': return 166
        default: return 54
      }
    case 'social':
      return 400
    case 'model':
      return 240
    case 'widget':
      return card.displaySize?.height ?? 360
    default:
      return 380 // live article/figma/maps iframe
  }
}

export function cardDims(card: Card): { w: number; h: number } {
  const w = cardWidth(card)
  if (card.embedMode === 'live' && card.type !== 'text') {
    return { w, h: liveHeight(card) + 30 }
  }
  switch (card.type) {
    case 'image':
    case 'sketch':
      return { w, h: 180 }
    case 'video':
      return { w, h: 210 }
    case 'audio':
      return { w, h: 76 }
    case 'social':
      return { w, h: card.meta?.image ? 260 : 150 }
    case 'link':
      return { w, h: card.meta?.image ? 250 : 130 }
    case 'sheet':
      return { w, h: 170 }
    case 'doc':
      return { w, h: 150 }
    case 'canvas':
      return { w, h: (card.document?.height ?? 270) + 70 }
    case 'model':
      return { w, h: 230 }
    case 'widget':
      return { w, h: card.displaySize ? card.displaySize.height + 30 : 140 }
    case 'file':
      return { w, h: 70 }
    default: {
      const chars = (card.title?.length ?? 0) + Math.min(card.content.length, 420)
      return { w, h: Math.min(46 + Math.ceil(chars / 34) * 18, 260) }
    }
  }
}
