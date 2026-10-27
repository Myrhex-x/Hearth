// Stands in for llama.cpp's llama-server in router mode, so the end-to-end
// tests drive Hearth's engine code (start, preset, loading, chat, completion,
// embeddings, stop) on any machine, in a second, with no model.
// Hearth runs it in place of the real binary when HEARTH_ENGINE_SCRIPT is set.

import http from 'http'
import { appendFileSync, readFileSync } from 'fs'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const keyFile = arg('--api-key-file')
const key = keyFile ? readFileSync(keyFile, 'utf8').split(/\r?\n/)[0].trim() : arg('--api-key')
const preset = arg('--models-preset')
const logFile = process.env.HEARTH_FAKE_ENGINE_LOG

function record(entry) {
  if (logFile) appendFileSync(logFile, JSON.stringify(entry) + '\n')
}

/** Like llama.cpp's common/preset.cpp: what follows a colon is taken for a quantization tag. */
function canonicalName(name) {
  const colon = name.lastIndexOf(':')
  if (colon < 0) return name
  const tag = name.slice(colon + 1)
  const m = /[-.]([A-Z0-9_]+)$/i.exec(tag)
  return name.slice(0, colon + 1) + (m ? m[1] : tag).toUpperCase()
}

function readPreset() {
  const models = new Map()
  let section = null
  for (const line of readFileSync(preset, 'utf8').split(/\r?\n/)) {
    const head = /^\[(.+)\]$/.exec(line.trim())
    if (head) {
      section = head[1] === '*' ? '*' : canonicalName(head[1])
      if (section !== '*') models.set(section, {})
      continue
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (kv && section && section !== '*') models.get(section)[kv[1].trim()] = kv[2].trim()
  }
  return models
}

let models = readPreset()
const states = new Map()

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function vector(text) {
  const v = new Array(64).fill(0)
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
    v[(h >>> 0) % 64] += 1
  }
  return v
}

const server = http.createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  const url = new URL(req.url, 'http://engine')
  if (url.pathname !== '/health' && req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: { message: 'Invalid API Key' } })
  record({ type: 'request', path: url.pathname + url.search, body })

  switch (url.pathname) {
    case '/health':
      return json(res, 200, { status: 'ok' })
    case '/models':
      if (url.searchParams.get('reload')) models = readPreset()
      return json(res, 200, { data: [...models.keys()].map((id) => ({ id, status: { value: states.get(id) ?? 'unloaded' } })) })
    case '/models/load':
      if (!models.has(body.model)) return json(res, 404, { error: { message: 'model not found' } })
      states.set(body.model, 'loading')
      setTimeout(() => states.set(body.model, 'loaded'), 300)
      return json(res, 200, { success: true })
    case '/models/unload':
      states.delete(body.model)
      return json(res, 200, { success: true })
    case '/v1/chat/completions': {
      if (states.get(body.model) !== 'loaded') return json(res, 503, { error: { message: 'Loading model' } })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const thinking = body.chat_template_kwargs?.enable_thinking !== false
      const deltas = [...(thinking ? [{ reasoning_content: 'Thinking it over.' }] : []), { content: 'Hello from ' }, { content: 'the built-in engine.' }]
      for (const delta of deltas) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
        await new Promise((r) => setTimeout(r, 15))
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 6 } })}\n\n`)
      return res.end('data: [DONE]\n\n')
    }
    case '/v1/embeddings': {
      const input = Array.isArray(body.input) ? body.input : [body.input]
      return json(res, 200, { data: input.map((t, index) => ({ embedding: vector(String(t)), index })) })
    }
    case '/infill':
      return json(res, 200, { content: 'return 42' })
    default:
      return json(res, 404, { error: { message: 'not found' } })
  }
})

server.listen(Number(arg('--port')), arg('--host') ?? '127.0.0.1', () => record({ type: 'start', pid: process.pid, args }))
process.on('SIGTERM', () => process.exit(0))
