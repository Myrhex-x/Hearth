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

type Msg = { role: string; content: string; tool_name?: string; images?: string[] }

const MODELS: Record<string, { capabilities: string[]; parameterSize: string }> = {
  'mock-coder:latest': { capabilities: ['completion', 'tools', 'insert'], parameterSize: '1B' },
  'mock-vision:latest': { capabilities: ['completion', 'vision'], parameterSize: '2B' },
  'mock-embed:latest': { capabilities: ['embedding'], parameterSize: '100M' }
}

export const DESCRIPTION = 'A terminal with an error:\n```\nTypeError: Cannot set properties of undefined (setting \'fed\')\n    at feedKittens (src/kittens.js:3)\n```'

const DIMS = 256

/** Words hashed into buckets: texts that share words point the same way, which is all the tests need. */
function embedText(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0)
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
    v[(h >>> 0) % DIMS] += 1
  }
  return v
}

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

async function chat(body: { model: string; messages: Msg[] }, res: http.ServerResponse): Promise<void> {
  const messages = body.messages
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  if (body.model === 'mock-vision:latest') {
    const sawImage = messages.some((m) => m.images?.length)
    if (system.includes('You describe images')) {
      const half = Math.floor(DESCRIPTION.length / 2)
      await stream(res, [
        { message: { role: 'assistant', content: sawImage ? DESCRIPTION.slice(0, half) : 'There is no image.' }, done: false },
        { message: { role: 'assistant', content: sawImage ? DESCRIPTION.slice(half) : '' }, done: false },
        done
      ])
      return
    }
    await stream(res, [{ message: { role: 'assistant', content: sawImage ? 'I can see the screenshot. ' : 'I see no image. ' }, done: false }, { message: { role: 'assistant', content: 'The kittens wait in the shelter.' }, done: false }, done])
    return
  }
  if (system.includes('You write git commit messages')) {
    await stream(res, [
      { message: { role: 'assistant', content: '```\nMake the answer 42 ' }, done: false },
      { message: { role: 'assistant', content: 'and add f()\n```' }, done: false },
      done
    ])
    return
  }
  if (system.includes('code rewriting engine')) {
    await stream(res, [
      { message: { role: 'assistant', content: 'export const ' }, done: false },
      { message: { role: 'assistant', content: 'answer = 42' }, done: false },
      done
    ])
    return
  }
  const lastUser = messages.map((m) => m.role).lastIndexOf('user')
  if (messages[lastUser]?.content.includes('<image name=')) {
    await stream(res, [{ message: { role: 'assistant', content: 'From the description, feedKittens gets no shelter.' }, done: false }, done])
    return
  }
  const tools = messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length
  if (messages[lastUser]?.content.includes('by meaning')) {
    if (tools === 0) return stream(res, [toolCall('search_meaning', { query: 'hungry kittens in the shelter get fed' }), done])
    return stream(res, [{ message: { role: 'assistant', content: 'They are fed in `src/kittens.js`.' }, done: false }, done])
  }
  if (tools === 0) return stream(res, [{ message: { role: 'assistant', content: 'Let me look at the file first.' }, done: false }, toolCall('read_file', { path: 'hello.txt' }), done])
  if (tools === 1) return stream(res, [toolCall('edit_file', { path: 'hello.txt', old_text: 'hello world', new_text: 'hello from hearth' }), done])
  if (tools === 2) return stream(res, [toolCall('run_command', { command: 'echo hearth-ran && echo second-step' }), done])
  await stream(res, [
    { message: { role: 'assistant', content: 'All done. ' }, done: false },
    { message: { role: 'assistant', content: 'I changed `hello.txt`.' }, done: false },
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
        return json(res, {
          models: Object.entries(MODELS).map(([name, m]) => ({
            name,
            size: 1_000_000_000,
            digest: `mock-${name}`,
            details: { family: 'mock', parameter_size: m.parameterSize, quantization_level: 'Q4_K_M' }
          }))
        })
      case '/api/show':
        return json(res, { capabilities: MODELS[String(body.model)]?.capabilities ?? ['completion'], model_info: { 'mock.context_length': 32768 } })
      case '/api/embed': {
        const input = Array.isArray(body.input) ? (body.input as string[]) : [String(body.input)]
        return json(res, { model: body.model, embeddings: input.map(embedText) })
      }
      case '/api/ps':
        return json(res, { models: [] })
      case '/api/generate':
        if (typeof body.suffix === 'string') return json(res, { response: 'return 42', done: true })
        return json(res, { response: '', done: true })
      case '/api/chat':
        return chat(body as { model: string; messages: Msg[] }, res)
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
