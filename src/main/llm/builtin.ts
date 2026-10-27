// The built-in engine as a model server: llama.cpp's router speaks the OpenAI
// dialect, so chat and embeddings go through openai.ts; code completion uses
// its fill-in-the-middle endpoint.

import type { ChatEvent, ChatRequest, CompletionRequest, LoadedModel, ModelInfo, ProviderConfig, PullProgress } from '../../shared/types'
import { modelIdOf } from '../../shared/types'
import { downloadSize, engineId } from '../../shared/engineCatalog'
import { engineHeaders, engineLoaded, ensureModel, installModel, installedModels, unloadModel } from '../engine'
import { getSettings } from '../settings'
import { http } from './http'
import { openaiChat, openaiEmbed } from './openai'
import { readError } from './stream'

async function server(p: ProviderConfig, name: string, signal?: AbortSignal): Promise<ProviderConfig> {
  const url = await ensureModel(name, signal)
  return { ...p, baseUrl: `${url}/v1`, apiKey: engineHeaders().authorization.slice('Bearer '.length) }
}

export async function builtinModels(p: ProviderConfig): Promise<ModelInfo[]> {
  return (await installedModels()).map((m) => ({
    id: modelIdOf(p.id, m.name),
    providerId: p.id,
    providerName: p.name,
    providerKind: 'builtin' as const,
    name: m.name,
    sizeBytes: downloadSize(m),
    parameterSize: m.parameterSize,
    family: m.family,
    quantization: m.quantization,
    capabilities: m.capabilities,
    contextLength: getSettings().contextWindow
  }))
}

export async function builtinLoaded(p: ProviderConfig): Promise<LoadedModel[]> {
  return (await engineLoaded()).map((m) => ({
    id: modelIdOf(p.id, m.name),
    providerId: p.id,
    name: m.name,
    sizeBytes: m.sizeBytes,
    vramBytes: m.sizeBytes
  }))
}

export async function builtinChat(p: ProviderConfig, name: string, req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void): Promise<void> {
  const target = await server(p, name, signal)
  // Hearth asks for no reasoning on quick jobs, and when thinking is turned off.
  const extra = req.think === false ? { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none' } : {}
  await openaiChat(target, engineId(name), req, signal, emit, extra)
}

export async function builtinComplete(p: ProviderConfig, name: string, req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const url = await ensureModel(name, signal)
  const res = await http(`${url}/infill`, {
    signal,
    headers: engineHeaders(),
    body: {
      model: engineId(name),
      input_prefix: req.prefix,
      input_suffix: req.suffix,
      n_predict: req.maxTokens,
      temperature: req.temperature ?? 0.15,
      top_p: 0.9,
      stream: false,
      cache_prompt: true,
      ...(req.stop?.length ? { stop: req.stop } : {})
    }
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { content?: string }
  return data.content ?? ''
}

export async function builtinEmbed(p: ProviderConfig, name: string, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  return openaiEmbed(await server(p, name, signal), engineId(name), inputs, signal)
}

export async function builtinPull(name: string, signal: AbortSignal, emit: (e: PullProgress) => void): Promise<void> {
  await installModel(name, signal, emit)
}

export async function builtinWarm(name: string): Promise<void> {
  await ensureModel(name)
}

export async function builtinUnload(name: string): Promise<void> {
  await unloadModel(name)
}
