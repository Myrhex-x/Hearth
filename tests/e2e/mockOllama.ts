// A scripted stand-in for Ollama, so the end-to-end tests run on any CI
// machine without a GPU or model downloads.

import http from 'http'
import type { AddressInfo } from 'net'

export interface Recorded {
  path: string
  body: Record<string, unknown>
}

export interface MockOllama {
  url: string
  requests: Recorded[]
  close(): Promise<void>
}

type Msg = { role: string; content: string; tool_name?: string }

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

function json(res: http.ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function stream(res: http.ServerResponse, chunks: unknown[]): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' })
  for (const c of chunks) {
    res.write(JSON.stringify(c) + '\n')
    await sleep(15)
  }
  res.end()
}

const done = { done: true, done_reason: 'stop', prompt_eval_count: 120, eval_count: 24, eval_duration: 400_000_000, total_duration: 600_000_000 }

function toolCall(name: string, args: Record<string, unknown>) {
  return { message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] }, done: false }
}

async function chat(body: { messages: Msg[] }, res: http.ServerResponse): Promise<void> {
  const messages = body.messages
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  if (system.includes('code rewriting engine')) {
    await stream(res, [
      { message: { role: 'assistant', content: 'export const ' }, done: false },
      { message: { role: 'assistant', content: 'answer = 42' }, done: false },
      done
    ])
    return
  }
  const lastUser = messages.map((m) => m.role).lastIndexOf('user')
  const tools = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length
  if (tools === 0) return stream(res, [{ message: { role: 'assistant', content: 'Let me look at the file first.' }, done: false }, toolCall('read_file', { path: 'hello.txt' }), done])
  if (tools === 1) return stream(res, [toolCall('edit_file', { path: 'hello.txt', old_text: 'hello world', new_text: 'hello from hearth' }), done])
  if (tools === 2) return stream(res, [toolCall('run_command', { command: 'echo hearth-ran && echo second-step' }), done])
  await stream(res, [
    { message: { role: 'assistant', content: 'All done. ' }, done: false },
    { message: { role: 'assistant', content: 'I changed **hello.txt**.' }, done: false },
    done
  ])
}

export async function startMockOllama(): Promise<MockOllama> {
  const requests: Recorded[] = []
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      body = {}
    }
    requests.push({ path: req.url ?? '', body })
    switch (req.url) {
      case '/api/version':
        return json(res, { version: '0.0.0-mock' })
      case '/api/tags':
        return json(res, { models: [{ name: 'mock-coder:latest', size: 1_000_000_000, digest: 'mock', details: { family: 'mock', parameter_size: '1B', quantization_level: 'Q4_K_M' } }] })
      case '/api/show':
        return json(res, { capabilities: ['completion', 'tools', 'insert'], model_info: { 'mock.context_length': 32768 } })
      case '/api/ps':
        return json(res, { models: [] })
      case '/api/generate':
        if (typeof body.suffix === 'string') return json(res, { response: 'return 42', done: true })
        return json(res, { response: '', done: true })
      case '/api/chat':
        return chat(body as { messages: Msg[] }, res)
      default:
        res.writeHead(404)
        res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
