import type {
  ChatEvent,
  ChatRequest,
  CompletionRequest,
  LlmMessage,
  LoadedModel,
  ModelCapability,
  ModelInfo,
  ProviderConfig,
  PullProgress,
  ToolCall
} from '../../shared/types'
import { modelIdOf } from '../../shared/types'
import { ThinkSplitter } from '../../shared/think'
import { http, joinUrl, randomId } from './http'
import { ndjson, readError } from './stream'

interface OllamaTag {
  name: string
  size?: number
  digest?: string
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}

interface OllamaShow {
  capabilities?: string[]
  model_info?: Record<string, unknown>
}

interface OllamaChunk {
  message?: {
    content?: string
    thinking?: string
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[]
  }
  done?: boolean
  error?: string
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number
  total_duration?: number
  load_duration?: number
}

const showCache = new Map<string, OllamaShow>()

async function show(p: ProviderConfig, name: string, digest?: string): Promise<OllamaShow> {
  const key = `${p.baseUrl}|${name}|${digest ?? ''}`
  const hit = showCache.get(key)
  if (hit) return hit
  const res = await http(joinUrl(p.baseUrl, '/api/show'), { body: { model: name }, timeoutMs: 8000 })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as OllamaShow
  const slim: OllamaShow = { capabilities: data.capabilities, model_info: {} }
  for (const [k, v] of Object.entries(data.model_info ?? {})) {
    if (k.endsWith('.context_length')) slim.model_info![k] = v
  }
  showCache.set(key, slim)
  return slim
}

export async function ollamaVersion(p: ProviderConfig): Promise<string> {
  // Windows takes a second or two to report a refused connection on loopback.
  const res = await http(joinUrl(p.baseUrl, '/api/version'), { timeoutMs: 3000 })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { version?: string }
  return data.version ?? 'unknown'
}

export async function ollamaModels(p: ProviderConfig): Promise<ModelInfo[]> {
  const res = await http(joinUrl(p.baseUrl, '/api/tags'), { timeoutMs: 4000 })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { models?: OllamaTag[] }
  const tags = (data.models ?? []).filter((m) => !/embed/i.test(m.name))
  return Promise.all(
    tags.map(async (m): Promise<ModelInfo> => {
      let capabilities: ModelCapability[] | undefined
      let contextLength: number | undefined
      try {
        const s = await show(p, m.name, m.digest)
        capabilities = s.capabilities as ModelCapability[] | undefined
        for (const v of Object.values(s.model_info ?? {})) if (typeof v === 'number') contextLength = v
      } catch {
        // older servers without /api/show details
      }
      return {
        id: modelIdOf(p.id, m.name),
        providerId: p.id,
        providerName: p.name,
        providerKind: 'ollama',
        name: m.name,
        sizeBytes: m.size,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        capabilities,
        contextLength
      }
    })
  )
}

export async function ollamaLoaded(p: ProviderConfig): Promise<LoadedModel[]> {
  const res = await http(joinUrl(p.baseUrl, '/api/ps'), { timeoutMs: 2000 })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as {
    models?: { name: string; size?: number; size_vram?: number; expires_at?: string; context_length?: number }[]
  }
  return (data.models ?? []).map((m) => ({
    id: modelIdOf(p.id, m.name),
    providerId: p.id,
    name: m.name,
    sizeBytes: m.size ?? 0,
    vramBytes: m.size_vram ?? 0,
    expiresAt: m.expires_at,
    contextLength: m.context_length
  }))
}

function toOllamaMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.toolName }
  const out: Record<string, unknown> = { role: m.role, content: m.content }
  if (m.images?.length) out.images = m.images
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
  }
  return out
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw)
      if (v && typeof v === 'object') return v
    } catch {
      return { _raw: raw }
    }
  }
  return {}
}

export async function ollamaChat(
  p: ProviderConfig,
  name: string,
  req: ChatRequest,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void
): Promise<void> {
  const body: Record<string, unknown> = {
    model: name,
    messages: req.messages.map(toOllamaMessage),
    stream: true,
    options: {
      ...(req.contextWindow ? { num_ctx: req.contextWindow } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { num_predict: req.maxTokens } : {})
    }
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  if (req.think !== undefined) body.think = req.think
  if (req.keepAlive) body.keep_alive = req.keepAlive

  const res = await http(joinUrl(p.baseUrl, '/api/chat'), { body, signal })
  if (!res.ok || !res.body) throw new Error(await readError(res))

  const splitter = new ThinkSplitter()
  const calls: ToolCall[] = []
  const startedAt = Date.now()
  for await (const chunk of ndjson<OllamaChunk>(res.body as ReadableStream<Uint8Array>)) {
    if (chunk.error) throw new Error(chunk.error)
    const msg = chunk.message
    if (msg?.thinking) emit({ type: 'thinking', text: msg.thinking })
    if (msg?.content) {
      const part = splitter.push(msg.content)
      if (part.thinking) emit({ type: 'thinking', text: part.thinking })
      if (part.content) emit({ type: 'content', text: part.content })
    }
    for (const tc of msg?.tool_calls ?? []) {
      if (!tc.function?.name) continue
      calls.push({ id: tc.id || randomId(), name: tc.function.name, arguments: parseArgs(tc.function.arguments) })
    }
    if (chunk.done) {
      const rest = splitter.flush()
      if (rest.thinking) emit({ type: 'thinking', text: rest.thinking })
      if (rest.content) emit({ type: 'content', text: rest.content })
      if (calls.length) emit({ type: 'tool_calls', calls })
      const evalNs = chunk.eval_duration ?? 0
      emit({
        type: 'done',
        stats: {
          promptTokens: chunk.prompt_eval_count,
          outputTokens: chunk.eval_count,
          tokensPerSecond: evalNs > 0 && chunk.eval_count ? chunk.eval_count / (evalNs / 1e9) : undefined,
          durationMs: chunk.total_duration ? Math.round(chunk.total_duration / 1e6) : Date.now() - startedAt,
          loadMs: chunk.load_duration ? Math.round(chunk.load_duration / 1e6) : undefined
        }
      })
      return
    }
  }
  const rest = splitter.flush()
  if (rest.content) emit({ type: 'content', text: rest.content })
  if (calls.length) emit({ type: 'tool_calls', calls })
  emit({ type: 'done' })
}

export async function ollamaComplete(p: ProviderConfig, name: string, req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const res = await http(joinUrl(p.baseUrl, '/api/generate'), {
    signal,
    body: {
      model: name,
      prompt: req.prefix,
      suffix: req.suffix,
      stream: false,
      keep_alive: req.keepAlive,
      options: {
        num_predict: req.maxTokens,
        temperature: req.temperature ?? 0.15,
        top_p: 0.9,
        ...(req.stop?.length ? { stop: req.stop } : {})
      }
    }
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { response?: string }
  return data.response ?? ''
}

export async function ollamaPull(p: ProviderConfig, name: string, signal: AbortSignal, emit: (e: PullProgress) => void): Promise<void> {
  const res = await http(joinUrl(p.baseUrl, '/api/pull'), { body: { model: name, stream: true }, signal })
  if (!res.ok || !res.body) throw new Error(await readError(res))
  for await (const line of ndjson<{ status?: string; total?: number; completed?: number; error?: string }>(res.body as ReadableStream<Uint8Array>)) {
    if (line.error) throw new Error(line.error)
    emit({ status: line.status ?? '', total: line.total, completed: line.completed })
  }
  showCache.clear()
}

/** Loads a model into memory (keepAlive like "30m") or evicts it (keepAlive 0). */
export async function ollamaKeepAlive(p: ProviderConfig, name: string, keepAlive: string | number): Promise<void> {
  const res = await http(joinUrl(p.baseUrl, '/api/generate'), { body: { model: name, keep_alive: keepAlive, stream: false } })
  if (!res.ok) throw new Error(await readError(res))
  await res.text()
}
