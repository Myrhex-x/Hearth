import { create } from 'zustand'
import type { IndexStatus, MeaningResult } from '../../../shared/types'
import { api } from '../api'

// The search-by-meaning index lives in the main process; this mirrors its status.

const OFF: IndexStatus = { state: 'off', model: null, files: 0, chunks: 0, done: 0, total: 0 }

interface MeaningStore {
  status: IndexStatus
  refresh(): Promise<void>
  reset(): void
  search(query: string, limit?: number, under?: string): Promise<MeaningResult[]>
  rebuild(): Promise<void>
}

export const useMeaning = create<MeaningStore>((set, get) => ({
  status: OFF,
  async refresh() {
    try {
      set({ status: await api.index.status() })
    } catch {
      set({ status: OFF })
    }
  },
  reset() {
    set({ status: OFF })
  },
  search(query, limit = 8, under) {
    return api.index.search(query, limit, under)
  },
  async rebuild() {
    await api.index.rebuild()
    await get().refresh()
  }
}))

/** True when there is something to search, even while the rest is still being indexed. */
export function meaningAvailable(): boolean {
  const s = useMeaning.getState().status
  return (s.state === 'ready' || s.state === 'indexing') && s.chunks > 0
}

export function startMeaningUpdates(): void {
  api.index.onStatus((status) => useMeaning.setState({ status }))
}
