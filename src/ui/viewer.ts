import { create } from 'zustand'
import type { Card } from '../types'

interface ViewerState {
  card: Card | null
  open(card: Card): void
  close(): void
}

export const useViewer = create<ViewerState>((set) => ({
  card: null,
  open: (card) => set({ card }),
  close: () => set({ card: null }),
}))

export const openViewer = (card: Card) => useViewer.getState().open(card)
