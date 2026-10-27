// Readers for the two streaming formats local servers use.

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        yield line
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

/** Newline-delimited JSON (Ollama). */
export async function* ndjson<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of lines(body)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    yield JSON.parse(trimmed) as T
  }
}

/** Server-sent events carrying JSON payloads (OpenAI-compatible servers). */
export async function* sse<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  let data: string[] = []
  for await (const line of lines(body)) {
    if (line === '') {
      if (data.length) {
        const payload = data.join('\n')
        data = []
        if (payload.trim() === '[DONE]') return
        try {
          yield JSON.parse(payload) as T
        } catch {
          // ignore keep-alive or malformed frames
        }
      }
      continue
    }
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length) {
    const payload = data.join('\n')
    if (payload.trim() !== '[DONE]') {
      try {
        yield JSON.parse(payload) as T
      } catch {
        // ignore
      }
    }
  }
}

export async function readError(res: { text(): Promise<string>; status: number; statusText: string }): Promise<string> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    // ignore
  }
  try {
    const parsed = JSON.parse(text)
    const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message
    if (typeof msg === 'string') return msg
  } catch {
    // not JSON
  }
  return text.trim().slice(0, 300) || `${res.status} ${res.statusText}`
}

/** Turns low-level fetch failures into something a person can act on. */
/** baseUrl is empty for the built-in engine, which has no address of its own in Settings. */
export function friendlyNetworkError(err: unknown, baseUrl: string): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e?.name === 'AbortError') return 'Stopped'
  if (e?.name === 'TimeoutError') return baseUrl ? `Nothing answered at ${baseUrl} in time. Is the model server running?` : 'The built-in engine did not answer in time.'
  const code = e?.cause?.code
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    if (!baseUrl) return 'The built-in engine stopped. Try again to restart it.'
    if (code === 'ECONNREFUSED') return `Nothing is answering at ${baseUrl}. Is the model server running?`
  }
  if (code === 'ENOTFOUND') return `Could not find the host in ${baseUrl}.`
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return 'The model server took too long to answer.'
  return e?.cause?.message || e?.message || String(err)
}
