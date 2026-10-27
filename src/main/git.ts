import { execFileSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { GitFileStatus, GitStatus } from '../shared/types'
import { storeEdition } from './edition'
import { getSettings } from './settings'
import { loadShellEnv } from './shellEnv'

// Thin wrapper over the git command line. Paths in and out are relative to the
// open folder, which may be a subfolder of the repository.

interface GitResult {
  stdout: string
  stderr: string
  code: number
}

class GitMissingError extends Error {}

let sandboxGit: string | undefined

/**
 * In Apple's sandbox, /usr/bin/git refuses to run ("xcrun cannot be used
 * within an App Sandbox"), but the developer tools' own git works: find it
 * the way xcrun would.
 */
function gitCommand(): string {
  if (!storeEdition || process.platform !== 'darwin') return 'git'
  if (sandboxGit === undefined) {
    sandboxGit = '/nonexistent/git'
    try {
      const developer = execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' }).trim()
      const found = [join(developer, 'usr', 'bin', 'git'), '/Library/Developer/CommandLineTools/usr/bin/git'].find((p) => existsSync(p))
      if (found) sandboxGit = found
    } catch {
      // no developer tools: reported as Git missing
    }
  }
  return sandboxGit
}

/** The store edition cannot read ~/.gitconfig, so the name and email for commits come from Settings. */
function identity(): Record<string, string> {
  if (!storeEdition) return {}
  const { gitName, gitEmail } = getSettings()
  if (!gitName.trim() || !gitEmail.trim()) return {}
  return { GIT_AUTHOR_NAME: gitName, GIT_COMMITTER_NAME: gitName, GIT_AUTHOR_EMAIL: gitEmail, GIT_COMMITTER_EMAIL: gitEmail }
}

function run(cwd: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitCommand(), args, {
      cwd,
      windowsHide: true,
      // Never wait on a password prompt nobody can see; credential helpers still work.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...identity() }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      reject(e.code === 'ENOENT' ? new GitMissingError('Git is not installed') : e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), code: code ?? -1 })
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

async function git(cwd: string, args: string[], opts?: { input?: string; timeoutMs?: number }): Promise<string> {
  await loadShellEnv()
  const res = await run(cwd, args, opts)
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout).trim().replace(/^(fatal|error): /gm, '')
    throw new Error(msg || `git ${args[0]} failed`)
  }
  return res.stdout
}

/**
 * Only call git when the folder sits inside a repository: on a Mac without the
 * command line tools, merely running /usr/bin/git opens an install dialog.
 */
export function insideRepository(root: string): boolean {
  let dir = root
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.git'))) return true
    const up = dirname(dir)
    if (up === dir) return false
    dir = up
  }
  return false
}

function kindOf(x: string, y: string, untracked: boolean, conflicted: boolean): GitFileStatus['kind'] {
  if (conflicted) return 'conflict'
  if (untracked) return 'untracked'
  const c = x !== '.' ? x : y
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R' || c === 'C') return 'renamed'
  if (c === 'T') return 'typechange'
  return 'modified'
}

/** Parses `git status --porcelain=v2 --branch -z`. Exported for tests. */
export function parseStatus(raw: string, prefix: string): Omit<GitStatus, 'available' | 'isRepo' | 'hasRemote'> {
  const status: Omit<GitStatus, 'available' | 'isRepo' | 'hasRemote'> = { branch: null, head: null, upstream: null, ahead: 0, behind: 0, files: [] }
  const strip = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : prefix ? null : p)
  const records = raw.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const type = rec[0]
    if (type === '?') {
      const path = strip(rec.slice(2))
      if (path) status.files.push({ path, x: '?', y: '?', kind: 'untracked', staged: false, unstaged: true })
      continue
    }
    if (type !== '1' && type !== '2' && type !== 'u') continue
    const fields = rec.split(' ')
    const xy = fields[1]
    const x = xy[0]
    const y = xy[1]
    // Paths may contain spaces: they are whatever follows the fixed fields.
    const fixed = type === '1' ? 8 : type === '2' ? 9 : 10
    const repoPath = fields.slice(fixed).join(' ')
    let origPath: string | undefined
    if (type === '2') origPath = records[++i]
    const path = strip(repoPath)
    if (!path) continue
    const conflicted = type === 'u'
    status.files.push({
      path,
      origPath: origPath ? (strip(origPath) ?? origPath) : undefined,
      x,
      y,
      kind: kindOf(x, y, false, conflicted),
      staged: !conflicted && x !== '.',
      unstaged: conflicted || y !== '.'
    })
  }
  status.files.sort((a, b) => a.path.localeCompare(b.path))
  return status
}

const prefixCache = new Map<string, string>()

async function prefixOf(root: string): Promise<string> {
  const hit = prefixCache.get(root)
  if (hit !== undefined) return hit
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim()
  prefixCache.set(root, prefix)
  return prefix
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const empty: GitStatus = { available: true, isRepo: false, branch: null, head: null, upstream: null, hasRemote: false, ahead: 0, behind: 0, files: [] }
  if (!insideRepository(root)) return empty
  try {
    const prefix = await prefixOf(root)
    const [raw, remotes] = await Promise.all([
      git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', '.'], { timeoutMs: 20000 }),
      git(root, ['remote'])
    ])
    return { ...empty, isRepo: true, hasRemote: remotes.trim().length > 0, ...parseStatus(raw, prefix) }
  } catch (err) {
    if (err instanceof GitMissingError) return { ...empty, available: false }
    return { ...empty, error: (err as Error).message }
  }
}

/** The committed version of a file, or null when it is not in HEAD. */
export async function gitShowHead(root: string, rel: string): Promise<string | null> {
  if (!insideRepository(root)) return null
  const res = await run(root, ['show', `HEAD:./${rel}`])
  if (res.code !== 0) return null
  if (res.stdout.includes('\0')) return null
  return res.stdout
}

function pathArgs(paths: string[]): string[] {
  return ['--', ...paths.map((p) => (p.startsWith('-') ? `./${p}` : p))]
}

export async function gitStage(root: string, paths: string[]): Promise<void> {
  await git(root, ['add', '-A', ...pathArgs(paths)])
}

export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  const hasHead = (await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0
  if (hasHead) await git(root, ['restore', '--staged', ...pathArgs(paths)])
  else await git(root, ['rm', '--cached', '-r', '--quiet', ...pathArgs(paths)])
}

/** Puts tracked files back as they are in the index. Untracked files are handled by the caller (Trash). */
export async function gitDiscard(root: string, paths: string[]): Promise<void> {
  await git(root, ['restore', '--worktree', ...pathArgs(paths)])
}

export async function gitCommit(root: string, message: string, all: boolean): Promise<string> {
  if (all) await git(root, ['add', '-A', '--', '.'])
  await git(root, ['commit', '--file=-'], { input: message, timeoutMs: 120000 })
  return (await git(root, ['log', '-1', '--format=%h %s'])).trim()
}

export async function gitPush(root: string, branch: string | null, hasUpstream: boolean): Promise<void> {
  if (hasUpstream || !branch) await git(root, ['push'], { timeoutMs: 120000 })
  else await git(root, ['push', '--set-upstream', 'origin', branch], { timeoutMs: 120000 })
}

export async function gitPull(root: string): Promise<void> {
  await git(root, ['pull', '--ff-only'], { timeoutMs: 120000 })
}

export async function gitFetch(root: string): Promise<void> {
  await git(root, ['fetch', '--prune'], { timeoutMs: 120000 })
}

export async function gitInit(root: string): Promise<void> {
  await git(root, ['init'])
  prefixCache.delete(root)
}

/** What changed, for the model to describe in a commit message. */
export async function gitChangeSummary(root: string): Promise<{ diff: string; staged: boolean; untracked: string[]; recent: string[] }> {
  const staged = (await git(root, ['diff', '--cached', '--name-only', '--', '.'])).trim().length > 0
  const hasHead = (await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0
  const diffArgs = staged ? ['diff', '--cached'] : hasHead ? ['diff', 'HEAD'] : ['diff']
  const diff = await git(root, [...diffArgs, '--no-color', '--no-ext-diff', '-U2', '--', '.'], { timeoutMs: 20000 })
  const untracked = staged ? [] : (await git(root, ['ls-files', '--others', '--exclude-standard', '--', '.'])).split('\n').filter(Boolean)
  const recent = hasHead ? (await git(root, ['log', '-n', '12', '--format=%s'])).split('\n').filter(Boolean) : []
  return { diff, staged, untracked, recent }
}

export function forgetRepository(root: string): void {
  prefixCache.delete(root)
}
