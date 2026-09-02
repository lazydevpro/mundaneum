export interface PointerSample {
  clientX: number
  clientY: number
  pressure?: number
}

export interface PointerLike extends PointerSample {
  pointerType: string
  getCoalescedEvents?: () => PointerEvent[]
}

/** Mirrors tldraw's direct-display check: a pen on a touch-capable device. */
export function isDirectDisplayPen(event: Pick<PointerLike, 'pointerType'>, maxTouchPoints = navigator.maxTouchPoints): boolean {
  return event.pointerType === 'pen' && maxTouchPoints > 0
}

/** iPadOS may present itself as a Mac with multiple touch points. */
export function isIosLike(userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

/**
 * tldraw consumes high-frequency coalesced samples where reliable, but
 * deliberately falls back to the dispatched event on iOS/WebKit.
 */
export function pointerSamples(event: PointerLike, ios = isIosLike()): PointerSample[] {
  if (!ios && event.getCoalescedEvents) {
    const samples = event.getCoalescedEvents()
    if (samples.length) return samples
  }
  return [event]
}
