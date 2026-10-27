import { spawn, type ChildProcess } from 'child_process'
import type { ExecResult } from '../shared/types'
import { adaptForWindowsPowerShell } from '../shared/winShell'
import { loadShellEnv, windowsPowerShell } from './shellEnv'

// Runs one command for the agent, after the person approved it.

const MAX_OUTPUT = 64 * 1024
const TIMEOUT_MS = 5 * 60 * 1000

const running = new Map<string, ChildProcess>()

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    // child.kill() on Windows would leave grandchildren (npm, node...) running.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

export async function runCommand(id: string, command: string, cwd: string, onOutput: (chunk: string) => void): Promise<ExecResult> {
  await loadShellEnv()
  const isWin = process.platform === 'win32'
  let file: string
  let args: string[]
  if (isWin) {
    const ps = windowsPowerShell()
    file = ps.exe
    const prelude = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
      "$ProgressPreference = 'SilentlyContinue'"
    ].join('; ')
    const body = ps.modern ? command : adaptForWindowsPowerShell(command)
    // -Command only reports 0 or 1; pass a native program's real exit code through.
    const epilogue = '$hearthOk = $?; if ((Test-Path variable:LASTEXITCODE) -and $LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $hearthOk) { exit 1 }'
    // -EncodedCommand (base64 of UTF-16LE) sidesteps every command line quoting rule.
    const script = `${prelude}\n${body}\n${epilogue}`
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
  } else {
    file = process.env.SHELL || '/bin/bash'
    args = ['-lc', command]
  }

  return new Promise<ExecResult>((resolve) => {
    let output = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', PAGER: 'cat', GIT_PAGER: 'cat' },
      windowsHide: true,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    running.set(id, child)
    // setEncoding keeps multi-byte characters intact across chunk boundaries.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const append = (text: string) => {
      onOutput(text)
      output += text
      if (output.length > MAX_OUTPUT) {
        output = output.slice(output.length - MAX_OUTPUT)
        truncated = true
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, TIMEOUT_MS)
    ;(child as ChildProcess & { __abort?: () => void }).__abort = () => {
      aborted = true
      killTree(child)
    }
    const finish = (exitCode: number | null) => {
      clearTimeout(timer)
      running.delete(id)
      resolve({ exitCode, output, truncated, timedOut, aborted })
    }
    child.on('error', (err) => {
      output += `\n${err.message}`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

export function abortCommand(id: string): void {
  const child = running.get(id) as (ChildProcess & { __abort?: () => void }) | undefined
  child?.__abort?.()
}
