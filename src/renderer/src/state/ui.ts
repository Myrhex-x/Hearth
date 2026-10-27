import { create } from 'zustand'
import { uid } from '../api'

export type PaletteMode = 'files' | 'commands'
export type SettingsSection = 'general' | 'models' | 'agent' | 'autocomplete' | 'search' | 'editor' | 'about'

export interface Toast {
  id: string
  text: string
  tone: 'info' | 'error' | 'success'
}

interface UiStore {
  palette: { mode: PaletteMode; query: string } | null
  settings: SettingsSection | null
  modelsOpen: boolean
  sidebarTab: 'files' | 'search' | 'changes'
  searchMode: 'exact' | 'meaning'
  /** A chat image shown full size. */
  lightbox: { id: string; name: string } | null
  searchFocusTick: number
  chatFocusTick: number
  dark: boolean
  toasts: Toast[]
  cursor: { line: number; column: number; selected: number } | null
  openPalette(mode: PaletteMode, query?: string): void
  closePalette(): void
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  setModelsOpen(open: boolean): void
  focusSearch(): void
  focusChat(): void
  toast(text: string, tone?: Toast['tone']): void
  dismissToast(id: string): void
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

export const useUi = create<UiStore>((set, get) => ({
  palette: null,
  settings: null,
  modelsOpen: false,
  sidebarTab: 'files',
  searchMode: 'exact',
  lightbox: null,
  searchFocusTick: 0,
  chatFocusTick: 0,
  dark: darkQuery.matches,
  toasts: [],
  cursor: null,
  openPalette: (mode, query = '') => set({ palette: { mode, query }, modelsOpen: false }),
  closePalette: () => set({ palette: null }),
  openSettings: (section = 'general') => set({ settings: section, palette: null, modelsOpen: false }),
  closeSettings: () => set({ settings: null }),
  setModelsOpen: (open) => set({ modelsOpen: open }),
  focusSearch: () => set((s) => ({ sidebarTab: 'search', searchFocusTick: s.searchFocusTick + 1 })),
  focusChat: () => set((s) => ({ chatFocusTick: s.chatFocusTick + 1 })),
  toast(text, tone = 'info') {
    const id = uid('toast')
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6500 : 3200)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

darkQuery.addEventListener('change', (e) => useUi.setState({ dark: e.matches }))

export const toast = (text: string, tone?: Toast['tone']) => useUi.getState().toast(text, tone)
