import { app } from 'electron'
import { existsSync, promises as fs, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { ENGINE_MODELS, REAL_TEST_MODELS, TEST_MODEL, downloadSize, engineId, fileUrl, folderName, type EngineCatalogEntry, type EngineFile, type EngineInfo, type EngineModel } from '../../shared/engineCatalog'
import type { PullProgress } from '../../shared/types'
import { http } from '../llm/http'
import { readError } from '../llm/stream'
import { getSettings } from '../settings'
import { downloadFile } from './download'
import { keepAliveSeconds, presetText, type PresetModel } from './preset'
import { Router } from './router'

// Hearth's own engine: llama.cpp's server, shipped inside the app, running
// the models Hearth downloads into its data folder. Nothing else to install.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** HEARTH_TEST_MODELS adds models for the tests: "real" ones the engine can run, or the stand-in's. */
function catalog(): EngineModel[] {
  const extra = process.env.HEARTH_TEST_MODELS
  if (!extra) return ENGINE_MODELS
  return [...ENGINE_MODELS, ...(extra === 'real' ? REAL_TEST_MODELS : [TEST_MODEL])]
}

export function engineModel(name: string): EngineModel | undefined {
  return catalog().find((m) => m.name === name)
}

function dataDir(): string {
  return join(app.getPath('userData'), 'engine')
}

export function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

/** Inside the app once packaged; engine/<os>-<arch> from scripts/fetch-engine.mjs while developing. */
function engineDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'engine')
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform as string] ?? process.platform
  // This file is bundled into out/main/index.js, two levels below the project.
  return join(__dirname, '..', '..', 'engine', `${os}-${process.arch}`)
}

function binaryPath(): string {
  return join(engineDir(), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
}

function engineVersion(): string | null {
  if (process.env.HEARTH_ENGINE_SCRIPT) return 'test'
  try {
    return readFileSync(join(engineDir(), 'VERSION'), 'utf8').trim()
  } catch {
    return null
  }
}

function filesOf(m: EngineModel): { file: EngineFile; path: string; relative: string }[] {
  return m.files.map((file) => {
    const relative = `${folderName(m.name)}/${file.name}`
    return { file, path: join(modelsDir(), ...relative.split('/')), relative }
  })
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size
  } catch {
    return -1
  }
}

export async function installedModels(): Promise<EngineModel[]> {
  const out: EngineModel[] = []
  for (const m of catalog()) {
    let complete = true
    for (const { file, path } of filesOf(m)) if ((await sizeOf(path)) !== file.size) complete = false
    if (complete) out.push(m)
  }
  return out
}

export async function engineCatalog(): Promise<EngineCatalogEntry[]> {
  const installed = new Set((await installedModels()).map((m) => m.name))
  return Promise.all(
    catalog().map(async (m) => {
      let partial = 0
      for (const { file, path } of filesOf(m)) {
        const done = await sizeOf(path)
        partial += done === file.size ? done : Math.max(0, await sizeOf(path + '.part'))
      }
      return { ...m, installed: installed.has(m.name), sizeBytes: downloadSize(m), partialBytes: installed.has(m.name) ? 0 : partial }
    })
  )
}

/**
 * Paths in the preset are relative to the models folder, where the engine
 * runs: a "#" or ";" in someone's home folder would end a value in llama.cpp's
 * preset format, and Windows reads relative paths whatever the user's name.
 */
let presetWrites: Promise<unknown> = Promise.resolve()

/** One write at a time: downloads that finish together all rewrite the preset. */
function writePreset(): Promise<string> {
  const next = presetWrites.then(writePresetNow)
  presetWrites = next.catch(() => {})
  return next
}

async function writePresetNow(): Promise<string> {
  const s = getSettings()
  const models: PresetModel[] = (await installedModels()).map((m) => {
    const files = filesOf(m)
    return {
      name: engineId(m.name),
      model: files.find((f) => f.file.role === 'model')!.relative,
      mmproj: files.find((f) => f.file.role === 'mmproj')?.relative,
      options: m.options
    }
  })
  await fs.mkdir(modelsDir(), { recursive: true })
  await fs.mkdir(dataDir(), { recursive: true })
  const file = join(dataDir(), 'models.ini')
  // Written whole and renamed, so the engine never reads half of it.
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, presetText(models, { contextWindow: s.contextWindow, sleepSeconds: keepAliveSeconds(s.keepAlive) }))
  await fs.rename(tmp, file)
  return file
}

const router = new Router(
  async (port, key) => {
    const preset = await writePreset()
    const cache = join(dataDir(), 'cache')
    await fs.mkdir(cache, { recursive: true })
    // In a file only this account can read, not on the command line where any process listing shows it.
    const keyFile = join(dataDir(), 'key')
    await fs.writeFile(keyFile, key + '\n', { mode: 0o600 })
    await fs.chmod(keyFile, 0o600)
    const args = ['--host', '127.0.0.1', '--port', String(port), '--api-key-file', keyFile, '--models-preset', preset, '--models-max', '4', '--no-ui', '--no-slots']
    // Settings meant for someone's own llama.cpp must not leak in; and only
    // Hearth's models are listed, not whatever sits in llama.cpp's usual cache.
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!/^LLAMA_(ARG_|API_KEY)/.test(k)) env[k] = v
    env.LLAMA_CACHE = cache
    const script = process.env.HEARTH_ENGINE_SCRIPT
    if (script) return { command: process.execPath, args: [script, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd: modelsDir() }
    return { command: binaryPath(), args, env, cwd: modelsDir() }
  },
  () => join(app.getPath('userData'), 'engine.pid')
)

export function engineHeaders(): Record<string, string> {
  return router.headers
}

export function engineAvailable(): boolean {
  return !!process.env.HEARTH_ENGINE_SCRIPT || existsSync(binaryPath())
}

export function engineInfo(): EngineInfo {
  return { available: engineAvailable(), version: engineVersion(), modelsDir: modelsDir(), running: !!router.url }
}

async function stateOf(name: string) {
  return (await router.models()).find((m) => m.id === engineId(name))?.status
}

/** Starts the engine and the model if needed; resolves once the model answers. */
export async function ensureModel(name: string, signal?: AbortSignal): Promise<string> {
  const url = await router.ensure()
  let st = await stateOf(name)
  if (!st) {
    // Downloaded since the engine started.
    await writePreset()
    await router.reload()
    st = await stateOf(name)
    if (!st) throw new Error(`${name} is not downloaded.`)
  }
  // A sleeping model wakes up by itself with the request.
  if (st.value === 'loaded' || st.value === 'sleeping') return url
  if (st.value !== 'loading') {
    const res = await http(`${url}/models/load`, { body: { model: engineId(name) }, headers: router.headers, signal })
    if (!res.ok) throw new Error(`Could not start ${name}: ${await readError(res)}`)
    await res.text()
  }
  const startedAt = Date.now()
  let sawLoading = st.value === 'loading'
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled')
    await sleep(250)
    st = await stateOf(name)
    if (st?.value === 'loaded' || st?.value === 'sleeping') return url
    if (st?.value === 'loading') sawLoading = true
    const failed = !st || (st.value === 'unloaded' && (st.failed || (sawLoading && Date.now() - startedAt > 2000)))
    if (failed || (!sawLoading && Date.now() - startedAt > 30_000)) {
      const log = router.tail(6)
      throw new Error(
        `${name} could not be loaded${st?.exit_code !== undefined ? ` (exit code ${st.exit_code})` : ''}. It may need more memory than is free.${log ? `\n${log}` : ''}`
      )
    }
  }
}

export async function engineLoaded(): Promise<{ name: string; sizeBytes: number }[]> {
  if (!router.url) return []
  const byId = new Map((await installedModels()).map((m) => [engineId(m.name), m]))
  return (await router.models())
    .filter((m) => m.status?.value === 'loaded' && byId.has(m.id))
    .map((m) => ({ name: byId.get(m.id)!.name, sizeBytes: downloadSize(byId.get(m.id)!) }))
}

export async function unloadModel(name: string): Promise<void> {
  const url = router.url
  if (!url) return
  const res = await http(`${url}/models/unload`, { body: { model: engineId(name) }, headers: router.headers, timeoutMs: 15_000 })
  await res.text()
}

async function freeSpace(dir: string): Promise<number | null> {
  try {
    const s = await fs.statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0)} GB`
}

export async function installModel(name: string, signal: AbortSignal, emit: (p: PullProgress) => void): Promise<void> {
  const m = engineModel(name)
  if (!m) throw new Error(`${name} is not one of the models Hearth can download.`)
  const files = filesOf(m)
  const total = downloadSize(m)
  for (const { path } of files) await fs.mkdir(dirname(path), { recursive: true })
  let needed = 0
  for (const { file, path } of files) needed += (await sizeOf(path)) === file.size ? 0 : file.size - Math.max(0, await sizeOf(path + '.part'))
  const free = await freeSpace(modelsDir())
  if (free !== null && free < needed + 512e6) throw new Error(`Not enough disk space: it needs ${gigabytes(needed)} more and ${gigabytes(free)} is free.`)

  let before = 0
  let lastEmit = 0
  emit({ status: 'downloading', completed: 0, total })
  for (const { file, path } of files) {
    try {
      await downloadFile({
        url: fileUrl(m, file, process.env.HEARTH_MODEL_MIRROR),
        dest: path,
        size: file.size,
        sha256: file.sha256,
        signal,
        onProgress: (bytes) => {
          const now = Date.now()
          if (now - lastEmit < 200 && bytes < file.size) return
          lastEmit = now
          emit({ status: 'downloading', completed: before + bytes, total })
        }
      })
    } catch (err) {
      if (signal.aborted) throw err
      const code = (err as { cause?: { code?: string } }).cause?.code ?? ''
      if (/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR)/.test(code)) {
        throw new Error('Could not reach Hugging Face, where the models come from. Check the connection, then try again: the download continues where it stopped.')
      }
      throw err
    }
    before += file.size
  }
  await writePreset()
  await router.reload().catch(() => {})
}

export async function removeModel(name: string): Promise<void> {
  if (!engineModel(name)) return
  await unloadModel(name).catch(() => {})
  // Windows keeps the file locked until the model's process has exited.
  await fs.rm(join(modelsDir(), folderName(name)), { recursive: true, force: true, maxRetries: 30, retryDelay: 500 })
  await writePreset()
  await router.reload().catch(() => {})
}

/** Context size or keep-warm time changed: models pick it up the next time they load. */
export async function engineSettingsChanged(): Promise<void> {
  if (!router.url) return
  await writePreset()
  await router.reload().catch(() => {})
}

export function stopEngine(): void {
  router.stop()
}
