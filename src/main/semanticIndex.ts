import { app } from 'electron'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { IndexStatus, MeaningResult } from '../shared/types'
import { splitModelId } from '../shared/types'
import { chunkText, documentText, normalize, queryText, topK, worthIndexing } from '../shared/semantic'
import { embed } from './llm'
import type { Workspace } from './workspace'

// Search by meaning: every text file is cut into pieces, each piece becomes a
// vector from a local embedding model, and a question is answered by the
// pieces whose vectors point the same way. Stored per project in the user
// data folder, refreshed as files change.

const MAX_FILES = 20000
const MAX_CHUNKS = 60000
const MAX_FILE_BYTES = 512 * 1024
const BATCH = 24

interface Row {
  path: string
  start: number
  end: number
  vec: Float32Array
}

interface StoredMeta {
  version: 1
  model: string
  dims: number
  files: Record<string, { mtimeMs: number; size: number }>
  /** [path index, start, end] per vector, in vectors.bin order. */
  rows: [number, number, number][]
  paths: string[]
}

function folderFor(root: string): string {
  const key = process.platform === 'linux' ? root : root.toLowerCase()
  return join(app.getPath('userData'), 'index', createHash('sha1').update(key).digest('hex').slice(0, 16))
}

export class SemanticIndex {
  status: IndexStatus = { state: 'off', model: null, files: 0, chunks: 0, done: 0, total: 0 }
  private rows: Row[] = []
  /** Files whose pieces are all in. A file can have rows before it is listed here. */
  private files = new Map<string, { mtimeMs: number; size: number }>()
  /** Every path that has rows, finished or not, so a half-indexed file can be dropped too. */
  private rowPaths = new Set<string>()
  private dims = 0
  private model: string | null = null
  private running: Promise<void> | null = null
  private abort: AbortController | null = null
  private dirty = new Set<string>()
  private dirtyTimer: NodeJS.Timeout | null = null
  private lastEmit = 0
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private ws: Workspace,
    private onStatus: (status: IndexStatus) => void
  ) {}

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    this.onStatus({ ...this.status })
  }

  private set(patch: Partial<IndexStatus>, force = true): void {
    this.status = { ...this.status, ...patch, files: this.files.size, chunks: this.rows.length }
    this.emit(force)
  }

  /** Starts, switches model, or turns the index off (model null). */
  async configure(model: string | null): Promise<void> {
    if (model === this.model && this.status.state !== 'error' && this.status.state !== 'off') return
    this.stop()
    await this.running?.catch(() => {})
    this.model = model
    if (!model) {
      this.clear()
      this.set({ state: 'no-model', model: null, done: 0, total: 0, error: undefined })
      return
    }
    await this.load(model)
    this.run(() => this.syncAll())
  }

  async rebuild(): Promise<void> {
    if (!this.model) return
    this.stop()
    await this.running?.catch(() => {})
    this.clear()
    await fs.rm(folderFor(this.ws.root), { recursive: true, force: true }).catch(() => {})
    this.run(() => this.syncAll())
  }

  /** Files changed on disk: re-embed them a moment later. */
  markDirty(paths: string[]): void {
    if (!this.model || this.disposed) return
    for (const p of paths) {
      if (!p || p.startsWith('.git/') || this.ws.isIgnored(p, false)) continue
      this.dirty.add(p)
    }
    if (!this.dirty.size) return
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer)
    this.dirtyTimer = setTimeout(() => {
      this.dirtyTimer = null
      const paths = [...this.dirty]
      this.dirty.clear()
      this.run(() => this.syncPaths(paths))
    }, 1500)
  }

  stop(): void {
    this.abort?.abort()
    if (this.dirtyTimer) clearTimeout(this.dirtyTimer)
    this.dirtyTimer = null
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      void this.save()
    }
  }

  async search(query: string, k = 8, under?: string): Promise<MeaningResult[]> {
    if (!this.model || !this.rows.length) return []
    const [vec] = await embed(this.model, [queryText(splitModelId(this.model).name, query)])
    const q = normalize(vec)
    if (q.length !== this.dims) throw new Error('The index was built with another model. Rebuild it from Settings.')
    const prefix = under ? under.replace(/\/+$/, '') + '/' : ''
    const { hits, mean } = topK(q, this.flat(), this.dims, k * 2, prefix ? (i) => this.rows[i].path.startsWith(prefix) : undefined)
    // Several overlapping pieces of the same place add nothing: keep the best one.
    const picked: { row: Row; score: number }[] = []
    for (const r of hits) {
      const row = this.rows[r.index]
      if (picked.some((p) => p.row.path === row.path && p.row.start <= row.end && row.start <= p.row.end)) continue
      picked.push({ row, score: r.score })
      if (picked.length >= k) break
    }
    const out: MeaningResult[] = []
    for (const { row, score } of picked) {
      let text = ''
      try {
        const file = await this.ws.readFile(row.path)
        text = file.content.split(/\r?\n/).slice(row.start - 1, row.end).join('\n')
      } catch {
        continue
      }
      out.push({ path: row.path, start: row.start, end: row.end, score, standout: score - mean, text })
    }
    return out
  }

  private flatCache: Float32Array | null = null

  private flat(): Float32Array {
    if (this.flatCache && this.flatCache.length === this.rows.length * this.dims) return this.flatCache
    const out = new Float32Array(this.rows.length * this.dims)
    this.rows.forEach((r, i) => out.set(r.vec, i * this.dims))
    this.flatCache = out
    return out
  }

  private run(job: () => Promise<void>): void {
    const previous = this.running ?? Promise.resolve()
    this.running = previous
      .catch(() => {})
      .then(async () => {
        if (this.disposed || !this.model) return
        this.abort = new AbortController()
        try {
          await job()
          if (!this.abort.signal.aborted) this.set({ state: 'ready', done: 0, total: 0, error: undefined, updatedAt: Date.now() })
        } catch (err) {
          if (this.abort?.signal.aborted) return
          this.set({ state: 'error', error: (err as Error).message })
        } finally {
          this.scheduleSave()
        }
      })
  }

  private async syncAll(): Promise<void> {
    this.set({ state: 'indexing', model: this.model, done: 0, total: 0, error: undefined })
    const { files } = await this.ws.walkFiles(MAX_FILES)
    const present = new Set(files)
    for (const path of new Set([...this.files.keys(), ...this.rowPaths])) if (!present.has(path)) this.dropFile(path)
    await this.embedFiles(files)
  }

  private async syncPaths(paths: string[]): Promise<void> {
    const existing: string[] = []
    for (const p of paths) {
      if ((await this.ws.exists(p)) === 'file') existing.push(p)
      else this.dropFile(p)
    }
    if (existing.length) {
      this.set({ state: 'indexing', done: 0, total: 0 })
      await this.embedFiles(existing)
    }
  }

  private clear(): void {
    this.rows = []
    this.files.clear()
    this.rowPaths.clear()
    this.flatCache = null
  }

  private dropFile(path: string): void {
    this.files.delete(path)
    if (!this.rowPaths.delete(path)) return
    this.rows = this.rows.filter((r) => r.path !== path)
    this.flatCache = null
  }

  private async embedFiles(paths: string[]): Promise<void> {
    const model = this.model!
    const modelName = splitModelId(model).name
    const signal = this.abort!.signal
    // Only what changed since the last pass.
    const todo: { path: string; mtimeMs: number; size: number }[] = []
    for (const path of paths) {
      try {
        const stat = await fs.stat(this.ws.resolve(path))
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
          this.dropFile(path)
          continue
        }
        const known = this.files.get(path)
        if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) continue
        todo.push({ path, mtimeMs: stat.mtimeMs, size: stat.size })
      } catch {
        this.dropFile(path)
      }
    }
    this.set({ total: todo.length, done: 0 })
    let pending: { path: string; start: number; end: number; text: string }[] = []
    const fileDone = new Map<string, { mtimeMs: number; size: number }>()
    const flush = async () => {
      if (!pending.length) return
      const batch = pending
      pending = []
      const vectors = await embed(model, batch.map((b) => b.text), signal)
      for (let i = 0; i < batch.length; i++) {
        const vec = normalize(vectors[i])
        if (!this.dims) this.dims = vec.length
        if (vec.length !== this.dims) throw new Error('The embedding model changed size. Rebuild the index from Settings.')
        this.rows.push({ path: batch[i].path, start: batch[i].start, end: batch[i].end, vec })
        this.rowPaths.add(batch[i].path)
      }
      this.flatCache = null
    }
    let done = 0
    for (const f of todo) {
      if (signal.aborted) return
      let text: string
      try {
        const file = await this.ws.readFile(f.path)
        if (file.binary || file.tooLarge) {
          this.dropFile(f.path)
          done++
          continue
        }
        text = file.content
      } catch {
        done++
        continue
      }
      this.dropFile(f.path)
      if (worthIndexing(f.path, text)) {
        for (const chunk of chunkText(text)) {
          if (this.rows.length + pending.length >= MAX_CHUNKS) break
          pending.push({ path: f.path, start: chunk.start, end: chunk.end, text: documentText(modelName, f.path, chunk) })
          if (pending.length >= BATCH) await flush()
        }
      }
      fileDone.set(f.path, { mtimeMs: f.mtimeMs, size: f.size })
      // A file counts as indexed once all of its pieces are in.
      if (!pending.length) {
        for (const [p, meta] of fileDone) this.files.set(p, meta)
        fileDone.clear()
      }
      done++
      this.status = { ...this.status, done, files: this.files.size, chunks: this.rows.length }
      this.emit()
      if (done % 200 === 0) this.scheduleSave()
    }
    await flush()
    for (const [p, meta] of fileDone) this.files.set(p, meta)
  }

  private async load(model: string): Promise<void> {
    this.clear()
    this.dims = 0
    const dir = folderFor(this.ws.root)
    try {
      const meta = JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf8')) as StoredMeta
      if (meta.version !== 1 || meta.model !== model) return
      const buf = await fs.readFile(join(dir, 'vectors.bin'))
      const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
      if (all.length !== meta.rows.length * meta.dims) return
      this.dims = meta.dims
      this.rows = meta.rows.map(([p, start, end], i) => ({ path: meta.paths[p], start, end, vec: all.subarray(i * meta.dims, (i + 1) * meta.dims) }))
      for (const r of this.rows) this.rowPaths.add(r.path)
      for (const [path, info] of Object.entries(meta.files)) this.files.set(path, info)
    } catch {
      // nothing saved yet, or from an older version
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 2000)
  }

  /** One write at a time: two interleaved writes could pair one save's vectors with another's list. */
  private save(): Promise<void> {
    this.saving = this.saving.then(() => this.write()).catch(() => {})
    return this.saving
  }

  private async write(): Promise<void> {
    if (!this.model || !this.dims) return
    const dir = folderFor(this.ws.root)
    await fs.mkdir(dir, { recursive: true })
    const paths: string[] = []
    const pathIndex = new Map<string, number>()
    const rows: [number, number, number][] = this.rows.map((r) => {
      let i = pathIndex.get(r.path)
      if (i === undefined) {
        i = paths.length
        paths.push(r.path)
        pathIndex.set(r.path, i)
      }
      return [i, r.start, r.end]
    })
    const meta: StoredMeta = { version: 1, model: this.model, dims: this.dims, files: Object.fromEntries(this.files), rows, paths }
    const vectors = this.flat()
    await fs.writeFile(join(dir, 'vectors.bin.tmp'), Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength))
    await fs.writeFile(join(dir, 'meta.json.tmp'), JSON.stringify(meta))
    await fs.rename(join(dir, 'vectors.bin.tmp'), join(dir, 'vectors.bin'))
    await fs.rename(join(dir, 'meta.json.tmp'), join(dir, 'meta.json'))
  }
}
