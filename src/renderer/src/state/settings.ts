import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../../../shared/types'
import { api } from '../api'

interface SettingsStore {
  settings: Settings
  loaded: boolean
  update(patch: SettingsPatch): Promise<void>
  /** Changes the UI right away without writing to disk (used while dragging). */
  preview(patch: SettingsPatch): void
}

function merge(base: Settings, patch: SettingsPatch): Settings {
  return {
    ...base,
    ...patch,
    agent: { ...base.agent, ...patch.agent },
    editor: { ...base.editor, ...patch.editor },
    terminal: { ...base.terminal, ...patch.terminal },
    layout: { ...base.layout, ...patch.layout }
  } as Settings
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async update(patch) {
    set({ settings: merge(get().settings, patch) })
    const next = await api.settings.set(patch)
    set({ settings: next })
  },
  preview(patch) {
    set({ settings: merge(get().settings, patch) })
  }
}))

export async function initSettings(): Promise<void> {
  const settings = await api.settings.get()
  useSettings.setState({ settings, loaded: true })
  api.settings.onChanged((s) => useSettings.setState({ settings: s }))
}

export function settingsNow(): Settings {
  return useSettings.getState().settings
}
