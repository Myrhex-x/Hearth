import { app, shell } from 'electron'
import { createHash } from 'crypto'
import { watch, type FSWatcher, promises as fs, existsSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve as resolvePath } from 'path'
import ignore, { type Ignore } from 'ignore'
import type { DirEntry, FileContent, SearchMatch, SearchOptions, SearchResult, WriteOptions } from '../shared/types'
import { relativeTo, resolveInside, toPosix } from './paths'

/** Never shown in the tree. */
const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini', '$RECYCLE.BIN', 'System Volume Information'])

/** Shown dimmed in the tree and skipped by search, quick open and the agent. */
const HEAVY_DIRS = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  'dist',
  'out',
  'build',
  'coverage',
  '.gradle',
  '.idea',
  'Pods',
  'DerivedData'
])

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_SEARCH_FILE_BYTES = 1024 * 1024

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class Workspace {
  readonly root: string
  readonly name: string
  private ig: Ignore = ignore()
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    root: string,
    private onChange: (paths: string[]) => void
  ) {
    this.root = resolvePath(root)
    this.name = basename(this.root) || this.root
  }

  async init(): Promise<void> {
    const stat = await fs.stat(this.root)
    if (!stat.isDirectory()) throw new Error('Not a folder: ' + this.root)
    await this.loadGitignore()
    this.startWatching()
  }

  private async loadGitignore(): Promise<void> {
    this.ig = ignore()
    try {
      this.ig.add(await fs.readFile(join(this.root, '.gitignore'), 'utf8'))
    } catch {
      // no .gitignore
    }
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        const rel = filename ? toPosix(filename.toString()) : ''
        if (rel && rel !== '.git/HEAD' && rel !== '.git/index' && /(^|\/)(node_modules|\.git)(\/|$)/.test(rel)) return
        this.pending.add(rel)
        if (rel === '.gitignore') void this.loadGitignore()
        if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            const paths = [...this.pending]
            this.pending.clear()
            this.onChange(paths)
          }, 150)
        }
      })
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      this.watcher = null
    }
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
  }

  resolve(rel: string): string {
    return resolveInside(this.root, rel)
  }

  rel(abs: string): string {
    return relativeTo(this.root, abs)
  }

  isIgnored(rel: string, isDir: boolean): boolean {
    if (!rel) return false
    const parts = rel.split('/')
    if (parts.some((p) => HEAVY_DIRS.has(p) || HIDDEN.has(p))) return true
    try {
      return this.ig.ignores(isDir ? rel + '/' : rel)
    } catch {
      return false
    }
  }

  async listDir(rel: string): Promise<DirEntry[]> {
    const abs = this.resolve(rel)
    const dirents = await fs.readdir(abs, { withFileTypes: true })
    const out: DirEntry[] = []
    for (const d of dirents) {
      if (HIDDEN.has(d.name)) continue
      const childRel = rel && rel !== '.' ? `${rel.replace(/\/$/, '')}/${d.name}` : d.name
      let isDir = d.isDirectory()
      if (d.isSymbolicLink()) {
        try {
          isDir = (await fs.stat(join(abs, d.name))).isDirectory()
        } catch {
          continue
        }
      }
      out.push({ name: d.name, path: childRel, kind: isDir ? 'dir' : 'file', ignored: this.isIgnored(childRel, isDir) })
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    return out
  }

  /** Every non-ignored file, for quick open, mentions and search. */
  async walkFiles(limit = 20000, under = ''): Promise<{ files: string[]; truncated: boolean }> {
    const files: string[] = []
    const start = under ? this.rel(this.resolve(under)) : ''
    const stack: string[] = [start]
    while (stack.length) {
      const dir = stack.pop()!
      let dirents
      try {
        dirents = await fs.readdir(dir ? this.resolve(dir) : this.root, { withFileTypes: true })
      } catch {
        continue
      }
      dirents.sort((a, b) => b.name.localeCompare(a.name))
      for (const d of dirents) {
        const rel = dir ? `${dir}/${d.name}` : d.name
        const isDir = d.isDirectory()
        if (d.isSymbolicLink()) continue
        if (this.isIgnored(rel, isDir)) continue
        if (isDir) stack.push(rel)
        else {
          files.push(rel)
          if (files.length >= limit) return { files, truncated: true }
        }
      }
    }
    files.sort((a, b) => a.localeCompare(b))
    return { files, truncated: false }
  }

  async readFile(rel: string): Promise<FileContent> {
    const abs = this.resolve(rel)
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) throw new Error(`${rel} is a folder, not a file`)
    const path = this.rel(abs)
    const base: FileContent = { path, content: '', binary: false, tooLarge: false, bom: false, size: stat.size, mtimeMs: stat.mtimeMs }
    const mime = IMAGE_TYPES[extname(abs).toLowerCase()]
    if (mime && stat.size < 8 * 1024 * 1024) {
      const buf = await fs.readFile(abs)
      return { ...base, binary: mime !== 'image/svg+xml', imageDataUrl: `data:${mime};base64,${buf.toString('base64')}`, content: mime === 'image/svg+xml' ? buf.toString('utf8') : '' }
    }
    if (stat.size > MAX_TEXT_BYTES) return { ...base, tooLarge: true }
    const buf = await fs.readFile(abs)
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return { ...base, content: buf.subarray(2).toString('utf16le'), bom: true, encoding: 'utf16le' }
    }
    if (looksBinary(buf)) return { ...base, binary: true }
    let content = buf.toString('utf8')
    let bom = false
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1)
      bom = true
    }
    return { ...base, content, bom }
  }

  async writeFile(rel: string, content: string, opts?: WriteOptions): Promise<void> {
    const abs = this.resolve(rel)
    await fs.mkdir(dirname(abs), { recursive: true })
    if (opts?.encoding === 'utf16le') {
      await fs.writeFile(abs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]))
      return
    }
    await fs.writeFile(abs, (opts?.bom ? '\ufeff' : '') + content, 'utf8')
  }

  /**
   * The path with the casing it really has on disk. macOS and Windows ignore
   * case, so "src/App.tsx" and "src/app.tsx" are the same file; the editor
   * must treat them as one too.
   */
  async canonical(rel: string): Promise<string> {
    const abs = this.resolve(rel)
    try {
      const [realRoot, real] = await Promise.all([fs.realpath(this.root), fs.realpath(abs)])
      const out = relative(realRoot, real)
      if (out && !out.startsWith('..') && !/^[a-zA-Z]:/.test(out)) return toPosix(out)
    } catch {
      // does not exist yet: keep what was asked for
    }
    return this.rel(abs)
  }

  async exists(rel: string): Promise<'file' | 'dir' | null> {
    try {
      const s = await fs.stat(this.resolve(rel))
      return s.isDirectory() ? 'dir' : 'file'
    } catch {
      return null
    }
  }

  async createFile(rel: string): Promise<void> {
    const abs = this.resolve(rel)
    if (existsSync(abs)) throw new Error(`${rel} already exists`)
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, '', { flag: 'wx' })
  }

  async createDir(rel: string): Promise<void> {
    await fs.mkdir(this.resolve(rel), { recursive: true })
  }

  async rename(from: string, to: string): Promise<void> {
    const a = this.resolve(from)
    const b = this.resolve(to)
    if (existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`${to} already exists`)
    await fs.mkdir(dirname(b), { recursive: true })
    await fs.rename(a, b)
  }

  async trash(rel: string): Promise<void> {
    const abs = this.resolve(rel)
    if (relative(this.root, abs) === '') throw new Error('Refusing to remove the project folder')
    await shell.trashItem(abs)
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    const query = opts.query ?? ''
    if (!query) return { matches: [], truncated: false, filesSearched: 0 }
    let re: RegExp
    try {
      const source = opts.regex ? query : escapeRegExp(query)
      re = new RegExp(opts.wholeWord ? `\\b(?:${source})\\b` : source, opts.caseSensitive ? 'g' : 'gi')
    } catch (err) {
      return { matches: [], truncated: false, filesSearched: 0, error: (err as Error).message }
    }
    const max = Math.max(1, Math.min(opts.maxResults ?? 400, 5000))
    const { files } = await this.walkFiles(30000, opts.under || '')
    const matches: SearchMatch[] = []
    const started = Date.now()
    let filesSearched = 0
    for (const rel of files) {
      if (Date.now() - started > 6000) return { matches, truncated: true, filesSearched }
      const abs = join(this.root, rel)
      let buf: Buffer
      try {
        const stat = await fs.stat(abs)
        if (stat.size > MAX_SEARCH_FILE_BYTES) continue
        buf = await fs.readFile(abs)
      } catch {
        continue
      }
      if (looksBinary(buf)) continue
      filesSearched++
      const lines = buf.toString('utf8').split(/\r?\n/)
      let perFile = 0
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        const m = re.exec(lines[i])
        if (!m) continue
        const text = lines[i].length > 400 ? lines[i].slice(0, 400) : lines[i]
        matches.push({ path: rel, line: i + 1, column: m.index + 1, length: Math.max(1, m[0].length), text })
        if (matches.length >= max) return { matches, truncated: true, filesSearched }
        if (++perFile >= 100) break
      }
    }
    return { matches, truncated: false, filesSearched }
  }

  async gitBranch(): Promise<string | null> {
    try {
      let gitDir = join(this.root, '.git')
      const stat = await fs.stat(gitDir)
      if (stat.isFile()) {
        const pointer = (await fs.readFile(gitDir, 'utf8')).trim()
        const m = /^gitdir:\s*(.+)$/m.exec(pointer)
        if (!m) return null
        gitDir = resolveGitDir(this.root, m[1].trim())
      }
      const head = (await fs.readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
      if (ref) return ref[1]
      return head.slice(0, 7)
    } catch {
      return null
    }
  }
}

function resolveGitDir(root: string, p: string): string {
  return /^([a-zA-Z]:)?[\\/]/.test(p) ? p : join(root, p)
}

export function workspaceStatePath(root: string): string {
  const key = process.platform === 'linux' ? root : root.toLowerCase()
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'workspaces', `${hash}.json`)
}
