import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_PROVIDERS, DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../shared/types'

const NESTED = ['agent', 'editor', 'terminal', 'layout'] as const

let cached: Settings | null = null
let writeChain: Promise<void> = Promise.resolve()

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function merge(base: Settings, patch: SettingsPatch): Settings {
  const next = { ...base, ...patch } as Settings
  for (const key of NESTED) {
    if (patch[key]) next[key] = { ...base[key], ...patch[key] } as never
  }
  return next
}

export function getSettings(): Settings {
  if (cached) return cached
  let loaded: SettingsPatch = {}
  try {
    if (existsSync(settingsPath())) loaded = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    loaded = {}
  }
  const settings = merge(structuredClone(DEFAULT_SETTINGS), loaded)
  if (!Array.isArray(settings.providers) || settings.providers.length === 0) {
    settings.providers = structuredClone(DEFAULT_PROVIDERS)
  }
  // Settings from before the built-in engine: add it, first.
  if (!settings.providers.some((p) => p.kind === 'builtin')) settings.providers.unshift(structuredClone(DEFAULT_PROVIDERS[0]))
  if (!Array.isArray(settings.recent)) settings.recent = []
  cached = settings
  return settings
}

export function updateSettings(patch: SettingsPatch): Settings {
  cached = merge(getSettings(), patch)
  const snapshot = JSON.stringify(cached, null, 2)
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      const tmp = settingsPath() + '.tmp'
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, settingsPath())
    })
    .catch((err) => console.error('[settings] write failed', err))
  return cached
}
