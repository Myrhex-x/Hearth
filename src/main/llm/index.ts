import type {
  ChatEvent,
  ChatRequest,
  CompletionRequest,
  LoadedModel,
  ModelInfo,
  ProviderConfig,
  ProviderStatus,
  PullProgress
} from '../../shared/types'
import { splitModelId } from '../../shared/types'
import { getSettings } from '../settings'
import { http, joinUrl } from './http'
import { ollamaChat, ollamaComplete, ollamaEmbed, ollamaKeepAlive, ollamaLoaded, ollamaModels, ollamaPull, ollamaVersion } from './ollama'
import { openaiChat, openaiComplete, openaiEmbed, openaiModels } from './openai'
import { builtinChat, builtinComplete, builtinEmbed, builtinLoaded, builtinModels, builtinPull, builtinUnload, builtinWarm } from './builtin'
import { engineAvailable, engineInfo } from '../engine'
import { friendlyNetworkError, readError } from './stream'

function providers(): ProviderConfig[] {
  return getSettings().providers.filter((p) => p.enabled)
}

function providerFor(modelId: string): { provider: ProviderConfig; name: string } {
  const { providerId, name } = splitModelId(modelId)
  const provider = getSettings().providers.find((p) => p.id === providerId)
  if (!provider) throw new Error(`The model server "${providerId}" is not configured anymore.`)
  return { provider, name }
}

async function ping(p: ProviderConfig): Promise<ProviderStatus> {
  const base: ProviderStatus = { id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, ok: false }
  try {
    if (p.kind === 'builtin') {
      const info = engineInfo()
      return engineAvailable()
        ? { ...base, ok: true, version: info.version ? `llama.cpp ${info.version}` : undefined }
        : { ...base, error: 'The engine is missing from this copy of Hearth. Developers: run npm run engine.' }
    }
    if (p.kind === 'ollama') return { ...base, ok: true, version: await ollamaVersion(p) }
    const res = await http(joinUrl(p.baseUrl, '/models'), {
      timeoutMs: 3000,
      headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}
    })
    if (!res.ok) return { ...base, error: await readError(res) }
    await res.text()
    return { ...base, ok: true }
  } catch (err) {
    return { ...base, error: friendlyNetworkError(err, p.baseUrl) }
  }
}

export async function providerStatus(): Promise<ProviderStatus[]> {
  return Promise.all(providers().map(ping))
}

export async function listModels(): Promise<ModelInfo[]> {
  const lists = await Promise.all(
    providers().map(async (p) => {
      try {
        if (p.kind === 'builtin') return await builtinModels(p)
        return p.kind === 'ollama' ? await ollamaModels(p) : await openaiModels(p)
      } catch {
        return []
      }
    })
  )
  return lists.flat()
}

export async function loadedModels(): Promise<LoadedModel[]> {
  const lists = await Promise.all(
    providers()
      .filter((p) => p.kind !== 'openai')
      .map((p) => (p.kind === 'builtin' ? builtinLoaded(p) : ollamaLoaded(p)).catch(() => [] as LoadedModel[]))
  )
  return lists.flat()
}

export async function chat(req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void): Promise<void> {
  let baseUrl = ''
  try {
    const { provider, name } = providerFor(req.modelId)
    baseUrl = provider.baseUrl
    if (provider.kind === 'builtin') await builtinChat(provider, name, req, signal, emit)
    else if (provider.kind === 'ollama') await ollamaChat(provider, name, req, signal, emit)
    else await openaiChat(provider, name, req, signal, emit)
  } catch (err) {
    if (signal.aborted) emit({ type: 'done' })
    else emit({ type: 'error', message: friendlyNetworkError(err, baseUrl) })
  }
}

export async function complete(req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const { provider, name } = providerFor(req.modelId)
  try {
    if (provider.kind === 'builtin') return await builtinComplete(provider, name, req, signal)
    return provider.kind === 'ollama'
      ? await ollamaComplete(provider, name, req, signal)
      : await openaiComplete(provider, name, req, signal)
  } catch (err) {
    if (signal.aborted) return ''
    throw new Error(friendlyNetworkError(err, provider.baseUrl))
  }
}

/** Vectors for a batch of texts, from an embedding model. */
export async function embed(modelId: string, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  const { provider, name } = providerFor(modelId)
  try {
    if (provider.kind === 'builtin') return await builtinEmbed(provider, name, inputs, signal)
    return provider.kind === 'ollama'
      ? await ollamaEmbed(provider, name, inputs, getSettings().keepAlive, signal)
      : await openaiEmbed(provider, name, inputs, signal)
  } catch (err) {
    throw new Error(friendlyNetworkError(err, provider.baseUrl))
  }
}

export async function pull(providerId: string, name: string, signal: AbortSignal, emit: (p: PullProgress) => void): Promise<void> {
  const provider = getSettings().providers.find((p) => p.id === providerId)
  try {
    if (provider?.kind === 'builtin') await builtinPull(name, signal, emit)
    else if (provider?.kind === 'ollama') await ollamaPull(provider, name, signal, emit)
    else throw new Error('Hearth downloads models into its own engine or through Ollama.')
    emit({ status: 'success', done: true })
  } catch (err) {
    emit({ status: 'error', done: true, error: signal.aborted ? 'Cancelled' : friendlyNetworkError(err, provider?.baseUrl ?? '') })
  }
}

export async function warm(modelId: string, keepAlive: string): Promise<void> {
  const { provider, name } = providerFor(modelId)
  if (provider.kind === 'builtin') await builtinWarm(name)
  else if (provider.kind === 'ollama') await ollamaKeepAlive(provider, name, keepAlive)
}

export async function unload(modelId: string): Promise<void> {
  const { provider, name } = providerFor(modelId)
  if (provider.kind === 'builtin') await builtinUnload(name)
  else if (provider.kind === 'ollama') await ollamaKeepAlive(provider, name, 0)
}
