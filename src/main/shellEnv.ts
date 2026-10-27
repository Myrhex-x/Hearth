import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { basename, delimiter, join } from 'path'

// Apps opened from the Finder or the Dock get a minimal PATH (/usr/bin:/bin:...),
// so `npm`, `git` from Homebrew or `cargo` would be missing. Read the PATH the
// user's login shell would have, the same way VS Code does.

let ready: Promise<void> | null = null

function readLoginShellPath(shell: string): Promise<string | null> {
  const marker = '__HEARTH_PATH__'
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '%s' "${marker}$PATH${marker}"`],
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true' } },
      (err, stdout) => {
        if (err && !stdout) return resolve(null)
        const parts = String(stdout).split(marker)
        resolve(parts.length >= 3 && parts[1] ? parts[1] : null)
      }
    )
  })
}

export function loadShellEnv(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    if (process.platform === 'win32') return
    const shell = process.env.SHELL || '/bin/zsh'
    const fromShell = await readLoginShellPath(shell)
    const current = (process.env.PATH || '').split(delimiter).filter(Boolean)
    const merged = new Set<string>(fromShell ? fromShell.split(delimiter).filter(Boolean) : [])
    for (const p of current) merged.add(p)
    const extras = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
    for (const p of extras) if (existsSync(p)) merged.add(p)
    process.env.PATH = [...merged].join(delimiter)
  })()
  return ready
}

export interface ShellChoice {
  /** Executable used for the interactive terminal. */
  shell: string
  args: string[]
  name: string
}

let pwshCache: string | null | undefined

function findOnPath(exe: string): string | null {
  const dirs = (process.env.PATH || '').split(delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    const full = join(dir, exe)
    if (existsSync(full)) return full
  }
  return null
}

/** PowerShell 7 (pwsh) if installed, since it understands `&&`; otherwise Windows PowerShell. */
export function windowsPowerShell(): { exe: string; modern: boolean } {
  // HEARTH_WINDOWS_POWERSHELL=5 forces Windows PowerShell 5.1 (used by CI, where pwsh is installed).
  if (process.env.HEARTH_WINDOWS_POWERSHELL === '5') return { exe: 'powershell.exe', modern: false }
  if (pwshCache === undefined) pwshCache = findOnPath('pwsh.exe')
  if (pwshCache) return { exe: pwshCache, modern: true }
  return { exe: 'powershell.exe', modern: false }
}

export function interactiveShell(): ShellChoice {
  if (process.platform === 'win32') {
    const ps = windowsPowerShell()
    // The default "Restricted" policy of Windows PowerShell blocks npm.ps1, npx.ps1 and friends.
    const args = ps.modern ? ['-NoLogo'] : ['-NoLogo', '-ExecutionPolicy', 'RemoteSigned']
    return { shell: ps.exe, args, name: ps.modern ? 'PowerShell 7' : 'Windows PowerShell' }
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { shell, args: ['-l'], name: basename(shell) }
}
