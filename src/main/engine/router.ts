import { execFileSync, spawn, spawnSync, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, promises as fs, readFileSync, rmSync } from 'fs'
import { createServer } from 'net'
import { dirname, join } from 'path'
import { http } from '../llm/http'

// One llama-server in router mode: it reads the preset, starts a process per
// model when one is asked for, and puts idle ones to sleep. Hearth starts it
// on first use, on a free port with a key of its own, and stops the whole
// process tree when it quits.
//
// It also stops when Hearth goes away any other way, a crash or Force Quit:
// Hearth holds a pipe to a small watchdog that starts the engine, and when the
// pipe closes, the watchdog stops the engine and every model it runs.

// The pipe moves to fd 3 first: a background job in a script gets /dev/null as its input.
export const WATCHDOG_SH = [
  'exec 3<&0',
  '"$@" </dev/null 3<&- &',
  'server=$!',
  '(read -r _ <&3; kill -TERM 0) &',
  'watcher=$!',
  'exec 3<&-',
  'wait "$server"',
  'code=$?',
  'kill "$watcher" 2>/dev/null',
  'exit "$code"'
].join('\n')

// Windows has no sh: Hearth's own executable runs this as Node. A killed
// parent does not always end the pipe there, so it also checks on Hearth itself.
export const WATCHDOG_JS = `const { spawn, spawnSync } = require('child_process')
const { appendFileSync } = require('fs')
const [parent, command, ...args] = process.argv.slice(2)
// For the tests: what the watchdog saw and did.
const log = (m) => process.env.HEARTH_WATCHDOG_LOG && appendFileSync(process.env.HEARTH_WATCHDOG_LOG, new Date().toISOString() + ' ' + m + '\\n')
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
log('started, parent ' + parent + ', server ' + child.pid)
let stopping = false
function stop(why) {
  if (stopping) return
  stopping = true
  log('stopping: ' + why)
  if (child.pid && process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
    log('taskkill exited ' + r.status + ' ' + (r.error ? r.error.message : '') + ' ' + (r.stderr || '').trim())
  } else child.kill('SIGTERM')
  process.exit(0)
}
process.stdin.on('end', () => stop('input ended'))
process.stdin.on('close', () => stop('input closed'))
process.stdin.on('error', (e) => stop('input error ' + e.code))
process.stdin.resume()
setInterval(() => {
  try {
    process.kill(Number(parent), 0)
  } catch (e) {
    stop('parent gone ' + e.code)
  }
}, 1000)
child.on('error', (err) => {
  log('server error ' + err.message)
  console.error(err.message)
  process.exit(1)
})
child.on('exit', (code) => {
  log('server exited ' + code)
  process.exit(code ?? 1)
})
`

export interface Launch {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

export type ModelState = 'unloaded' | 'loading' | 'loaded' | 'sleeping' | 'downloading'

export interface RouterModel {
  id: string
  status?: { value?: ModelState; failed?: boolean; exit_code?: number }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    // Started as a group leader: this reaches the router and every model it started.
    else process.kill(-pid, 'SIGTERM')
  } catch {
    // already gone
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether a process is a llama-server, so a reused PID is never touched. */
function isEngine(pid: number): boolean {
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
        : execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    return /llama-server/i.test(out)
  } catch {
    return false
  }
}

export class Router {
  readonly key = randomBytes(24).toString('hex')
  private child: ChildProcess | null = null
  private port = 0
  private starting: Promise<void> | null = null
  private lines: string[] = []
  private cleaned = false

  constructor(
    private launch: (port: number, key: string) => Promise<Launch>,
    /** A function: the data folder is only final once the app is ready. */
    private pidFile: () => string
  ) {}

  get url(): string | null {
    return this.child && this.port ? `http://127.0.0.1:${this.port}` : null
  }

  get headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}` }
  }

  /** The last lines the engine printed, for error messages. */
  tail(n = 8): string {
    return this.lines.slice(-n).join('\n')
  }

  async ensure(): Promise<string> {
    if (this.url) return this.url
    if (!this.starting) this.starting = this.start().finally(() => (this.starting = null))
    await this.starting
    if (!this.url) throw new Error('The model engine stopped while starting.')
    return this.url
  }

  async models(): Promise<RouterModel[]> {
    const url = this.url
    if (!url) return []
    const res = await http(`${url}/models`, { headers: this.headers, timeoutMs: 3000 })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: RouterModel[] }
    return data.data ?? []
  }

  /** After the preset changed: models that are not running pick up their new settings. */
  async reload(): Promise<void> {
    const url = this.url
    if (!url) return
    const res = await http(`${url}/models?reload=1`, { headers: this.headers, timeoutMs: 5000 })
    await res.text()
  }

  private async cleanStale(): Promise<void> {
    if (this.cleaned) return
    this.cleaned = true
    try {
      const { pid } = JSON.parse(readFileSync(this.pidFile(), 'utf8')) as { pid: number }
      if (pid && alive(pid) && isEngine(pid)) killTree(pid)
    } catch {
      // nothing left over from a previous run
    }
  }

  private async start(): Promise<void> {
    await this.cleanStale()
    const port = await freePort()
    const l = await this.launch(port, this.key)
    if (!existsSync(l.command)) throw new Error('The model engine is missing from this copy of Hearth.')
    let command = '/bin/sh'
    let args = ['-c', WATCHDOG_SH, 'hearth-engine', l.command, ...l.args]
    let env = l.env
    if (process.platform === 'win32') {
      const script = join(dirname(this.pidFile()), 'engine-watchdog.cjs')
      await fs.writeFile(script, WATCHDOG_JS)
      command = process.execPath
      args = [script, String(process.pid), l.command, ...l.args]
      env = { ...l.env, ELECTRON_RUN_AS_NODE: '1' }
    }
    // stdin stays open for the life of Hearth: the watchdog's signal.
    const child = spawn(command, args, { cwd: l.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    child.stdin?.on('error', () => {})
    this.lines = []
    const take = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        this.lines.push(line.length > 400 ? line.slice(0, 400) + '…' : line)
        if (this.lines.length > 300) this.lines.shift()
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    let exit = ''
    child.once('error', (err) => (exit = err.message))
    child.once('exit', (code, signal) => {
      exit ||= `it stopped (${signal ?? `exit code ${code}`})`
      if (this.child === child) {
        this.child = null
        this.port = 0
      }
    })
    if (child.pid) await fs.writeFile(this.pidFile(), JSON.stringify({ pid: child.pid })).catch(() => {})

    const deadline = Date.now() + 60_000
    for (;;) {
      if (exit) throw new Error(`The model engine could not start: ${exit}.${this.lines.length ? `\n${this.tail(6)}` : ''}`)
      try {
        const res = await http(`http://127.0.0.1:${port}/models`, { headers: this.headers, timeoutMs: 1500 })
        await res.text()
        if (res.ok) break
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        if (child.pid) killTree(child.pid)
        throw new Error('The model engine did not answer within a minute.')
      }
      await sleep(150)
    }
    this.child = child
    this.port = port
  }

  /** Stops the engine and every model it runs. Safe to call when it is not running. */
  stop(): void {
    const child = this.child
    this.child = null
    this.port = 0
    if (child?.pid) killTree(child.pid)
    // Synchronous: this also runs while the app quits.
    rmSync(this.pidFile(), { force: true })
  }
}
