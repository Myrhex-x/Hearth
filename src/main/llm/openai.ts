// Any server speaking the OpenAI chat completions dialect: LM Studio,
// llama.cpp's llama-server, vLLM, Jan, LocalAI, or a remote gateway.

import type { ChatEvent, ChatRequest, CompletionRequest, LlmMessage, ModelInfo, ProviderConfig, ToolCall } from '../../shared/types'
import { modelIdOf } from '../../shared/types'
import { ThinkSplitter } from '../../shared/think'
import { http, joinUrl, randomId } from './http'
import { readError, sse } from './stream'

function headers(p: ProviderConfig): Record<string, string> {
  return p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}
}

export async function openaiModels(p: ProviderConfig): Promise<ModelInfo[]> {
  const res = await http(joinUrl(p.baseUrl, '/models'), { headers: headers(p), timeoutMs: 4000 })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { data?: { id: string }[] }
  return (data.data ?? [])
    .filter((m) => m.id && !/embed/i.test(m.id))
    .map((m) => ({
      id: modelIdOf(p.id, m.id),
      providerId: p.id,
      providerName: p.name,
      providerKind: 'openai' as const,
      name: m.id
    }))
}

function toOpenAiMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  if (m.images?.length && m.role === 'user') {
    return {
      role: 'user',
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))
      ]
    }
  }
  const out: Record<string, unknown> = { role: m.role, content: m.content }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.arguments) }
    }))
  }
  return out
}

interface Delta {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

interface Chunk {
  choices?: { delta?: Delta; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string } | string
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const text = raw.trim()
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : { value: v }
  } catch {
    // Small models sometimes leave a trailing comma or drop the closing brace.
    const repaired = text.replace(/,\s*([}\]])/g, '$1')
    for (const candidate of [repaired, repaired + '}', repaired + '"}']) {
      try {
        const v = JSON.parse(candidate)
        if (v && typeof v === 'object') return v
      } catch {
        // keep trying
      }
    }
    return { _raw: raw }
  }
}

export async function openaiChat(
  p: ProviderConfig,
  name: string,
  req: ChatRequest,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void
): Promise<void> {
  const body: Record<string, unknown> = {
    model: name,
    messages: req.messages.map(toOpenAiMessage),
    stream: true,
    stream_options: { include_usage: true }
  }
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.maxTokens) body.max_tokens = req.maxTokens
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  }
  const res = await http(joinUrl(p.baseUrl, '/chat/completions'), { body, headers: headers(p), signal })
  if (!res.ok || !res.body) throw new Error(await readError(res))

  const splitter = new ThinkSplitter()
  const partial = new Map<number, { id?: string; name: string; args: string }>()
  const startedAt = Date.now()
  let firstTokenAt = 0
  let outputTokens: number | undefined
  let promptTokens: number | undefined
  let chunks = 0

  for await (const chunk of sse<Chunk>(res.body as ReadableStream<Uint8Array>)) {
    if (chunk.error) throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message || 'Model error')
    if (chunk.usage) {
      outputTokens = chunk.usage.completion_tokens
      promptTokens = chunk.usage.prompt_tokens
    }
    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue
    if (!firstTokenAt) firstTokenAt = Date.now()
    chunks++
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (reasoning) emit({ type: 'thinking', text: reasoning })
    if (delta.content) {
      const part = splitter.push(delta.content)
      if (part.thinking) emit({ type: 'thinking', text: part.thinking })
      if (part.content) emit({ type: 'content', text: part.content })
    }
    for (const tc of delta.tool_calls ?? []) {
      const index = tc.index ?? 0
      const entry = partial.get(index) ?? { name: '', args: '' }
      if (tc.id) entry.id = tc.id
      if (tc.function?.name) entry.name += tc.function.name
      if (tc.function?.arguments) entry.args += tc.function.arguments
      partial.set(index, entry)
    }
  }
  const rest = splitter.flush()
  if (rest.thinking) emit({ type: 'thinking', text: rest.thinking })
  if (rest.content) emit({ type: 'content', text: rest.content })
  const calls: ToolCall[] = [...partial.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, c]) => c.name)
    .map(([, c]) => ({ id: c.id || randomId(), name: c.name, arguments: parseToolArguments(c.args) }))
  if (calls.length) emit({ type: 'tool_calls', calls })
  const genSeconds = firstTokenAt ? (Date.now() - firstTokenAt) / 1000 : 0
  const tokens = outputTokens ?? chunks
  emit({
    type: 'done',
    stats: {
      promptTokens,
      outputTokens: tokens,
      tokensPerSecond: genSeconds > 0.05 ? tokens / genSeconds : undefined,
      durationMs: Date.now() - startedAt
    }
  })
}

export async function openaiComplete(p: ProviderConfig, name: string, req: CompletionRequest, signal: AbortSignal): Promise<string> {
  const res = await http(joinUrl(p.baseUrl, '/completions'), {
    signal,
    headers: headers(p),
    body: {
      model: name,
      prompt: req.prefix,
      suffix: req.suffix,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.15,
      stream: false,
      ...(req.stop?.length ? { stop: req.stop } : {})
    }
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { choices?: { text?: string }[] }
  return data.choices?.[0]?.text ?? ''
}
