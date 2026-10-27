import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { promises as fs, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, normalize } from 'path'
import { pathToFileURL } from 'url'
import type { AppInfo, ChatRequest, CompletionRequest, ContextMenuItem, MessageBoxOptions, SearchOptions, SettingsPatch, WriteOptions } from '../shared/types'
import { abortCommand, runCommand } from './exec'
import * as llm from './llm'
import { buildMenu } from './menu'
import { getSettings, updateSettings } from './settings'
import { isInside } from './paths'
import { interactiveShell, loadShellEnv } from './shellEnv'
import { createTerminal, killAllTerminals, killTerminal, killTerminalsOf, resizeTerminal, writeTerminal } from './terminal'
import { Workspace, workspaceStatePath } from './workspace'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const RENDERER_DIR = join(__dirname, '../renderer')

protocol.registerSchemesAsPrivileged([
  { scheme: 'hearth', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

if (isWin) app.setAppUserModelId('dev.myrhex.hearth')
app.setName('Hearth')
// Lets tests and screenshots run against a throwaway profile.
if (process.env.HEARTH_USER_DATA) app.setPath('userData', process.env.HEARTH_USER_DATA)

interface WindowState {
  win: BrowserWindow
  workspace: Workspace | null
  /** A folder given on the command line or dropped on the Dock, opening right now. */
  opening: Promise<unknown> | null
  allowClose: boolean
  rendererReady: boolean
}

const windows = new Map<number, WindowState>()
const aborts = new Map<string, AbortController>()
let quitting = false

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ')

function registerProtocol(): void {
  protocol.handle('hearth', async (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = normalize(join(RENDERER_DIR, rel))
    if (!isInside(RENDERER_DIR, file)) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    if (!rel.endsWith('.html')) return res
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

function overlayColors(): { color: string; symbolColor: string; height: number } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#191613', symbolColor: '#d9d0c7', height: 46 }
    : { color: '#efebe6', symbolColor: '#3b342e', height: 46 }
}

function stateOf(sender: WebContents): WindowState {
  const s = windows.get(sender.id)
  if (!s) throw new Error('Unknown window')
  return s
}

function ws(sender: WebContents): Workspace {
  const w = stateOf(sender).workspace
  if (!w) throw new Error('No folder is open')
  return w
}

function createWindow(folder?: string): BrowserWindow {
  const first = windows.size === 0 && !folder
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 540,
    show: false,
    title: 'Hearth',
    backgroundColor: isMac ? '#00000000' : dark ? '#191613' : '#efebe6',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 15 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const }
      : { titleBarOverlay: overlayColors() }),
    ...(isMac ? {} : { icon: join(__dirname, '../../resources/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  const id = win.webContents.id
  const state: WindowState = { win, workspace: null, opening: null, allowClose: false, rendererReady: false }
  windows.set(id, state)
  if (folder) state.opening = openWorkspace(win.webContents, folder).catch(() => null)

  win.once('ready-to-show', () => win.show())
  win.on('close', (e) => {
    if (state.allowClose || !state.rendererReady || win.webContents.isCrashed()) return
    e.preventDefault()
    win.webContents.send('app:close-requested')
  })
  win.on('closed', () => {
    state.workspace?.dispose()
    windows.delete(id)
  })
  win.webContents.on('render-process-gone', () => {
    state.allowClose = true
    state.rendererReady = false
  })
  win.webContents.on('destroyed', () => killTerminalsOf(win.webContents))
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const query = first ? '?first=1' : ''
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + query)
  else void win.loadURL('hearth://app/index.html' + query)
  return win
}

function windowsBuild(): number {
  return isWin ? Number(process.getSystemVersion().split('.')[2] || 0) : 0
}

function osName(): string {
  const v = process.getSystemVersion()
  if (isMac) return `macOS ${v}`
  if (isWin) {
    const build = windowsBuild()
    return build >= 22000 ? `Windows 11 (build ${build})` : `Windows 10 (build ${build})`
  }
  return `Linux ${v}`
}

/** A folder passed on the command line, as in `Hearth.exe D:\code\app` or "Open with". */
function folderFromArgs(argv: string[]): string | undefined {
  const args = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'))
  for (const a of args.reverse()) {
    try {
      if (statSync(a).isDirectory()) return a
    } catch {
      // not a path
    }
  }
  return undefined
}

async function existsQuickly(p: string, ms = 800): Promise<boolean> {
  // A disconnected network drive can block for the whole SMB timeout.
  return Promise.race([
    fs.access(p).then(
      () => true,
      () => false
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms))
  ])
}

function handle<A extends unknown[], R>(channel: string, fn: (sender: WebContents, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => fn(e.sender, ...(args as A)))
}

function on<A extends unknown[]>(channel: string, fn: (sender: WebContents, ...args: A) => void): void {
  ipcMain.on(channel, (e: IpcMainEvent, ...args: unknown[]) => fn(e.sender, ...(args as A)))
}

function safeSend(target: WebContents, channel: string, ...args: unknown[]): void {
  if (!target.isDestroyed()) target.send(channel, ...args)
}

async function openWorkspace(sender: WebContents, root: string) {
  const state = stateOf(sender)
  const workspace = new Workspace(root, (paths) => safeSend(sender, 'ws:changed', paths))
  await workspace.init()
  state.workspace?.dispose()
  state.workspace = workspace
  const settings = getSettings()
  const recent = [{ root, name: workspace.name, openedAt: Date.now() }, ...settings.recent.filter((r) => r.root !== root)].slice(0, 12)
  updateSettings({ recent, lastWorkspace: root })
  state.win.setTitle(workspace.name)
  if (isMac) state.win.setRepresentedFilename(root)
  app.addRecentDocument(root)
  return { root, name: workspace.name }
}

function registerIpc(): void {
  // App
  handle('app:info', (): AppInfo => {
    const sh = interactiveShell()
    return {
      version: app.getVersion(),
      platform: process.platform as AppInfo['platform'],
      arch: process.arch,
      osName: osName(),
      windowsBuild: windowsBuild(),
      shell: sh.shell,
      shellName: isWin ? (sh.name === 'PowerShell 7' ? 'PowerShell 7 (pwsh)' : 'Windows PowerShell 5.1') : sh.name,
      home: homedir(),
      isDev: !app.isPackaged
    }
  })
  on('app:renderer-ready', (sender) => {
    stateOf(sender).rendererReady = true
  })
  on('app:confirm-close', (sender) => {
    const state = stateOf(sender)
    state.allowClose = true
    state.win.close()
    if (quitting) setImmediate(() => app.quit())
  })
  on('app:cancel-close', () => {
    quitting = false
  })
  on('app:new-window', () => createWindow())
  on<[string]>('app:open-external', (_s, url) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
  })
  on<[string]>('app:reveal', (sender, rel) => {
    try {
      shell.showItemInFolder(ws(sender).resolve(rel))
    } catch {
      // no workspace
    }
  })
  on<[number]>('app:zoom', (sender, level) => sender.setZoomLevel(level))
  handle<[ContextMenuItem[]], string | null>('app:context-menu', (sender, items) => {
    return new Promise((resolve) => {
      let settled = false
      const done = (v: string | null) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      const menu = Menu.buildFromTemplate(
        items.map((it) =>
          it.type === 'separator'
            ? { type: 'separator' as const }
            : { label: it.label, accelerator: it.accelerator, enabled: it.enabled !== false, registerAccelerator: false, click: () => done(it.id ?? null) }
        )
      )
      const win = BrowserWindow.fromWebContents(sender)
      menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => done(null), 60) })
    })
  })
  handle<[MessageBoxOptions], number>('app:message-box', async (sender, options) => {
    const win = BrowserWindow.fromWebContents(sender)
    const opts = { ...options, noLink: true }
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return res.response
  })

  // Settings
  handle('settings:get', () => getSettings())
  handle<[SettingsPatch], unknown>('settings:set', (_s, patch) => {
    const next = updateSettings(patch)
    if (patch.theme) nativeTheme.themeSource = next.theme
    for (const s of windows.values()) safeSend(s.win.webContents, 'settings:changed', next)
    return next
  })

  // Workspace
  handle('ws:pick', async (sender) => {
    const win = BrowserWindow.fromWebContents(sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const], title: 'Open a project folder' }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return openWorkspace(sender, res.filePaths[0])
  })
  handle<[string], unknown>('ws:open', (sender, root) => openWorkspace(sender, root))
  handle('ws:close', (sender) => {
    const state = stateOf(sender)
    state.workspace?.dispose()
    state.workspace = null
    state.win.setTitle('Hearth')
    if (isMac) state.win.setRepresentedFilename('')
    updateSettings({ lastWorkspace: null })
  })
  handle('ws:current', async (sender) => {
    const pending = stateOf(sender).opening
    if (pending) await pending
    const w = stateOf(sender).workspace
    return w ? { root: w.root, name: w.name } : null
  })
  handle('ws:recent', async () => {
    const recent = getSettings().recent
    const alive = await Promise.all(recent.map((r) => existsQuickly(r.root)))
    return recent.filter((_, i) => alive[i])
  })
  handle<[string], void>('ws:forget-recent', (_s, root) => {
    updateSettings({ recent: getSettings().recent.filter((r) => r.root !== root) })
  })
  handle<[string], unknown>('ws:list-dir', (sender, rel) => ws(sender).listDir(rel))
  handle('ws:list-files', (sender) => ws(sender).walkFiles())
  handle<[string], unknown>('ws:read', (sender, rel) => ws(sender).readFile(rel))
  handle<[string, string, WriteOptions | undefined], void>('ws:write', (sender, rel, content, opts) => ws(sender).writeFile(rel, content, opts))
  handle<[string], string>('ws:canonical', (sender, rel) => ws(sender).canonical(rel))
  handle<[string], unknown>('ws:exists', (sender, rel) => ws(sender).exists(rel))
  handle<[string], void>('ws:create-file', (sender, rel) => ws(sender).createFile(rel))
  handle<[string], void>('ws:create-dir', (sender, rel) => ws(sender).createDir(rel))
  handle<[string, string], void>('ws:rename', (sender, a, b) => ws(sender).rename(a, b))
  handle<[string], void>('ws:trash', (sender, rel) => ws(sender).trash(rel))
  handle<[SearchOptions], unknown>('ws:search', (sender, opts) => ws(sender).search(opts))
  handle('ws:git-branch', (sender) => ws(sender).gitBranch())
  handle('ws:load-state', async (sender) => {
    try {
      return JSON.parse(await fs.readFile(workspaceStatePath(ws(sender).root), 'utf8'))
    } catch {
      return null
    }
  })
  handle<[unknown], void>('ws:save-state', async (sender, data) => {
    const file = workspaceStatePath(ws(sender).root)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file + '.tmp', JSON.stringify(data), 'utf8')
    await fs.rename(file + '.tmp', file)
  })

  // Models
  handle('llm:status', () => llm.providerStatus())
  handle('llm:models', () => llm.listModels())
  handle('llm:loaded', () => llm.loadedModels())
  on<[string, ChatRequest]>('llm:chat', (sender, id, req) => {
    const ac = new AbortController()
    aborts.set(id, ac)
    void llm.chat(req, ac.signal, (event) => safeSend(sender, 'llm:event', id, event)).finally(() => aborts.delete(id))
  })
  on<[string]>('llm:abort', (_s, id) => aborts.get(id)?.abort())
  handle<[string, CompletionRequest], string>('llm:complete', async (_s, id, req) => {
    const ac = new AbortController()
    aborts.set(id, ac)
    try {
      return await llm.complete(req, ac.signal)
    } finally {
      aborts.delete(id)
    }
  })
  on<[string, string, string]>('llm:pull', (sender, id, providerId, name) => {
    const ac = new AbortController()
    aborts.set(id, ac)
    void llm.pull(providerId, name, ac.signal, (p) => safeSend(sender, 'llm:pull-progress', id, p)).finally(() => aborts.delete(id))
  })
  handle<[string, string], void>('llm:warm', (_s, modelId, keepAlive) => llm.warm(modelId, keepAlive))
  handle<[string], void>('llm:unload', (_s, modelId) => llm.unload(modelId))

  // Terminal
  handle<[{ cols: number; rows: number }], unknown>('term:create', (sender, opts) => {
    const root = stateOf(sender).workspace?.root ?? homedir()
    return createTerminal(sender, root, opts.cols, opts.rows)
  })
  on<[string, string]>('term:write', (_s, id, data) => writeTerminal(id, data))
  on<[string, number, number]>('term:resize', (_s, id, c, r) => resizeTerminal(id, c, r))
  on<[string]>('term:kill', (_s, id) => killTerminal(id))

  // Agent commands
  handle<[string, string, string | undefined], unknown>('exec:run', (sender, id, command, cwdRel) => {
    const cwd = ws(sender).resolve(cwdRel || '.')
    return runCommand(id, command, cwd, (chunk) => safeSend(sender, 'exec:output', id, chunk))
  })
  on<[string]>('exec:abort', (_s, id) => abortCommand(id))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const folder = folderFromArgs(argv)
    if (folder) {
      createWindow(folder)
      return
    }
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else createWindow()
  })

  // macOS: a folder dropped on the Dock icon or opened with "Open With".
  let launchFolder = folderFromArgs(process.argv)
  app.on('open-file', (e, path) => {
    e.preventDefault()
    try {
      if (!statSync(path).isDirectory()) return
    } catch {
      return
    }
    if (app.isReady()) createWindow(path)
    else launchFolder = path
  })

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'Hearth',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright 2026 Myrhex. MIT license.',
      website: 'https://github.com/Myrhex-x/Hearth'
    })
    nativeTheme.themeSource = getSettings().theme
    nativeTheme.on('updated', () => {
      if (isMac) return
      for (const s of windows.values()) {
        try {
          s.win.setTitleBarOverlay(overlayColors())
          s.win.setBackgroundColor(overlayColors().color)
        } catch {
          // overlay not supported on this system
        }
      }
    })
    void loadShellEnv()
    registerProtocol()
    registerIpc()
    buildMenu(() => createWindow())
    createWindow(launchFolder)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    killAllTerminals()
    if (!isMac || quitting) app.quit()
  })
  app.on('will-quit', () => {
    for (const ac of aborts.values()) ac.abort()
    killAllTerminals()
  })
}
