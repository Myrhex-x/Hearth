import type { WebContents } from 'electron'
import { accessSync, chmodSync, constants, existsSync } from 'fs'
import { dirname, join } from 'path'
import type { IPty } from 'node-pty'
import { interactiveShell, loadShellEnv } from './shellEnv'

type PtyModule = typeof import('node-pty')

let ptyModule: PtyModule | null = null
let ptyLoadError: string | null = null

/** Safety net for a spawn-helper that lost its executable bit (see scripts/fix-pty.mjs). */
function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const root = dirname(require.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked')
    for (const file of [join(root, 'build', 'Release', 'spawn-helper'), join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')]) {
      if (!existsSync(file)) continue
      try {
        accessSync(file, constants.X_OK)
      } catch {
        chmodSync(file, 0o755)
      }
    }
  } catch {
    // read-only install: the build step already fixed the permissions
  }
}

function loadPty(): PtyModule | null {
  if (ptyModule || ptyLoadError) return ptyModule
  ensureSpawnHelper()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require('node-pty') as PtyModule
  } catch (err) {
    ptyLoadError = (err as Error).message
  }
  return ptyModule
}

interface Session {
  pty: IPty
  owner: WebContents
  pending: string
  timer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()
let counter = 0

export async function createTerminal(
  owner: WebContents,
  cwd: string,
  cols: number,
  rows: number
): Promise<{ id: string; shell: string } | { error: string }> {
  const mod = loadPty()
  if (!mod) return { error: `The terminal could not start: ${ptyLoadError}` }
  await loadShellEnv()
  const choice = interactiveShell()
  let pty: IPty
  try {
    pty = mod.spawn(choice.shell, choice.args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols | 0),
      rows: Math.max(2, rows | 0),
      cwd,
      env: { ...process.env, TERM_PROGRAM: 'Hearth', COLORTERM: 'truecolor' } as Record<string, string>
    })
  } catch (err) {
    return { error: `The terminal could not start ${choice.shell}: ${(err as Error).message}` }
  }
  const id = `t${++counter}`
  const session: Session = { pty, owner, pending: '', timer: null }
  sessions.set(id, session)
  pty.onData((data) => {
    session.pending += data
    if (!session.timer) {
      session.timer = setTimeout(() => {
        session.timer = null
        if (!owner.isDestroyed() && session.pending) owner.send('term:data', id, session.pending)
        session.pending = ''
      }, 8)
    }
  })
  pty.onExit(({ exitCode }) => {
    if (session.timer) clearTimeout(session.timer)
    if (!owner.isDestroyed()) {
      if (session.pending) owner.send('term:data', id, session.pending)
      owner.send('term:exit', id, exitCode)
    }
    sessions.delete(id)
  })
  return { id, shell: choice.name }
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  try {
    sessions.get(id)?.pty.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
  } catch {
    // the process may have exited between the resize and the call
  }
}

export function killTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.pty.kill()
  } catch {
    // already gone
  }
  sessions.delete(id)
}

export function killTerminalsOf(owner: WebContents): void {
  for (const [id, s] of sessions) if (s.owner === owner) killTerminal(id)
}

export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}
