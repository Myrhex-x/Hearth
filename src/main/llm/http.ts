import { Agent, fetch } from 'undici'

// Local models can take minutes to load and to read a long prompt before the
// first byte comes back, so the usual 5 minute header and body timeouts are off.
const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connect: { timeout: 5000 } })

export interface HttpInit {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

export type HttpResponse = Awaited<ReturnType<typeof fetch>>

export function http(url: string, init: HttpInit = {}): Promise<HttpResponse> {
  const signals: AbortSignal[] = []
  if (init.signal) signals.push(init.signal)
  if (init.timeoutMs) signals.push(AbortSignal.timeout(init.timeoutMs))
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  let body: string | undefined
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  return fetch(url, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    dispatcher: agent
  })
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

export function randomId(prefix = 'call'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}
