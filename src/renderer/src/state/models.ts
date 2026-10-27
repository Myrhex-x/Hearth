import { create } from 'zustand'
import type { GenStats, LoadedModel, ModelInfo, ProviderStatus, PullProgress } from '../../../shared/types'
import { api, uid } from '../api'
import { settingsNow, useSettings } from './settings'
import { toast } from './ui'

export type Activity = 'idle' | 'waiting' | 'streaming'

export interface PullState extends PullProgress {
  requestId: string
  providerId: string
  name: string
}

interface ModelsStore {
  models: ModelInfo[]
  statuses: ProviderStatus[]
  loaded: LoadedModel[]
  ready: boolean
  refreshing: boolean
  activity: Activity
  activityModel: string | null
  liveTokens: number
  lastStats: (GenStats & { modelId: string }) | null
  autocompleteBusy: boolean
  autocompleteError: string | null
  pulls: Record<string, PullState>
  refresh(): Promise<void>
  refreshLoaded(): Promise<void>
  pull(providerId: string, name: string): void
  cancelPull(name: string): void
  warm(modelId: string): Promise<void>
  unload(modelId: string): Promise<void>
}

export const useModels = create<ModelsStore>((set, get) => ({
  models: [],
  statuses: [],
  loaded: [],
  ready: false,
  refreshing: false,
  activity: 'idle',
  activityModel: null,
  liveTokens: 0,
  lastStats: null,
  autocompleteBusy: false,
  autocompleteError: null,
  pulls: {},

  async refresh() {
    set({ refreshing: true })
    try {
      const [statuses, models, loaded] = await Promise.all([api.llm.providerStatus(), api.llm.listModels(), api.llm.loaded()])
      set({ statuses, models, loaded, ready: true })
      pickDefaults(models)
    } finally {
      set({ refreshing: false })
    }
  },

  async refreshLoaded() {
    try {
      set({ loaded: await api.llm.loaded() })
    } catch {
      // keep the last known list
    }
  },

  pull(providerId, name) {
    const requestId = uid('pull')
    set({ pulls: { ...get().pulls, [name]: { requestId, providerId, name, status: 'starting' } } })
    const off = api.llm.onPullProgress(requestId, (p) => {
      const cur = get().pulls[name]
      if (!cur) return
      set({ pulls: { ...get().pulls, [name]: { ...cur, ...p, total: p.total ?? cur.total, completed: p.completed ?? cur.completed } } })
      if (p.done) {
        off()
        if (p.error) toast(`Could not download ${name}: ${p.error}`, 'error')
        else toast(`${name} is ready`, 'success')
        const next = { ...get().pulls }
        delete next[name]
        set({ pulls: next })
        void get().refresh()
      }
    })
    api.llm.pull(requestId, providerId, name)
  },

  cancelPull(name) {
    const p = get().pulls[name]
    if (p) api.llm.abort(p.requestId)
  },

  async warm(modelId) {
    try {
      set({ activity: 'waiting', activityModel: modelId })
      await api.llm.warm(modelId, settingsNow().keepAlive)
    } catch (err) {
      toast(`Could not load the model: ${(err as Error).message}`, 'error')
    } finally {
      set({ activity: 'idle' })
      void get().refreshLoaded()
    }
  },

  async unload(modelId) {
    try {
      await api.llm.unload(modelId)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
    void get().refreshLoaded()
  }
}))

function sizeScore(m: ModelInfo): number {
  const b = parseFloat((m.parameterSize ?? m.name.match(/(\d+(?:\.\d+)?)b/i)?.[1] ?? '0').toString())
  return Number.isFinite(b) ? b : 0
}

/** Chooses sensible models the first time, or when the chosen one disappeared. */
/** Embedding models only turn text into numbers: they can never chat or complete code. */
export function isEmbeddingModel(m: ModelInfo): boolean {
  return !!m.capabilities?.includes('embedding') || /embed/i.test(m.name)
}

export function chatModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => !isEmbeddingModel(m))
}

export function visionModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => !isEmbeddingModel(m) && m.capabilities?.includes('vision'))
}

export function embeddingModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter(isEmbeddingModel)
}

function pickDefaults(models: ModelInfo[]): void {
  const s = settingsNow()
  const ids = new Set(models.map((m) => m.id))
  const patch: { chatModel?: string; autocompleteModel?: string; imageModel?: string; embeddingModel?: string } = {}
  const talkers = chatModels(models)
  if (!s.chatModel || !ids.has(s.chatModel)) {
    const ranked = [...talkers].sort((a, b) => chatRank(b) - chatRank(a))
    if (ranked[0]) patch.chatModel = ranked[0].id
  }
  if (!s.imageModel || !ids.has(s.imageModel)) {
    // Small and quick: it only describes what it sees for the chat model.
    const seers = visionModels(models).sort((a, b) => sizeScore(a) - sizeScore(b))
    const pick = seers.find((m) => /qwen3-vl|qwen2\.5vl|gemma3|minicpm|llava|granite.*vision|moondream|mistral-small3/i.test(m.name) && sizeScore(m) <= 9) ?? seers[0]
    if (pick) patch.imageModel = pick.id
  }
  if (!s.embeddingModel || !ids.has(s.embeddingModel)) {
    const order = [/qwen3-embedding/i, /nomic-embed/i, /embeddinggemma/i, /snowflake-arctic-embed/i, /mxbai-embed/i, /bge-m3/i]
    const embedders = embeddingModels(models)
    const pick = order.map((re) => embedders.find((m) => re.test(m.name))).find(Boolean) ?? embedders[0]
    if (pick) patch.embeddingModel = pick.id
  }
  if (!s.autocompleteModel || !ids.has(s.autocompleteModel)) {
    const fim = talkers.filter((m) => m.capabilities?.includes('insert'))
    fim.sort((a, b) => sizeScore(a) - sizeScore(b))
    const coder = fim.find((m) => /coder|starcoder|codestral|deepseek-coder|codegemma/i.test(m.name) && sizeScore(m) <= 8)
    const pick = coder ?? fim.find((m) => sizeScore(m) <= 8) ?? fim[0]
    if (pick) patch.autocompleteModel = pick.id
  }
  if (Object.keys(patch).length) void useSettings.getState().update(patch)
}

function chatRank(m: ModelInfo): number {
  let r = 0
  if (m.capabilities?.includes('tools')) r += 50
  if (!m.capabilities) r += 20
  const b = sizeScore(m)
  if (b >= 7 && b <= 34) r += 20
  else if (b > 2 && b < 7) r += 8
  if (/coder|qwen3|devstral|gpt-oss|llama3\.[13]|mistral|granite/i.test(m.name)) r += 10
  if (/embed|vision|-vl|whisper/i.test(m.name)) r -= 40
  return r
}

export function modelById(id: string | null | undefined): ModelInfo | undefined {
  if (!id) return undefined
  return useModels.getState().models.find((m) => m.id === id)
}

export function supportsTools(id: string | null | undefined): boolean {
  const m = modelById(id)
  if (!m) return true
  return !m.capabilities || m.capabilities.includes('tools')
}

export function supportsThinking(id: string | null | undefined): boolean {
  return !!modelById(id)?.capabilities?.includes('thinking')
}

export function supportsVision(id: string | null | undefined): boolean {
  return !!modelById(id)?.capabilities?.includes('vision')
}

let pollTimer: number | null = null

export function startModelPolling(): void {
  if (pollTimer) return
  const tick = () => {
    const visible = document.visibilityState === 'visible'
    if (visible) void useModels.getState().refreshLoaded()
    pollTimer = window.setTimeout(tick, visible ? 5000 : 20000)
  }
  pollTimer = window.setTimeout(tick, 4000)
  window.addEventListener('focus', () => void useModels.getState().refresh())
}
