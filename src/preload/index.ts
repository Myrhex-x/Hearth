import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HearthApi } from './api'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/** Subscribe to a channel whose first argument is a request id, keeping only matching events. */
function subscribeFor<T>(channel: string, id: string, cb: (payload: T) => void): () => void {
  return subscribe<[string, T]>(channel, (eventId, payload) => {
    if (eventId === id) cb(payload)
  })
}

const api: HearthApi = {
  platform: process.platform as HearthApi['platform'],
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    onMenuCommand: (cb) => subscribe<[string]>('menu:command', cb),
    onCloseRequested: (cb) => subscribe<[]>('app:close-requested', cb),
    confirmClose: () => ipcRenderer.send('app:confirm-close'),
    cancelClose: () => ipcRenderer.send('app:cancel-close'),
    rendererReady: () => ipcRenderer.send('app:renderer-ready'),
    newWindow: () => ipcRenderer.send('app:new-window'),
    openExternal: (url) => ipcRenderer.send('app:open-external', url),
    revealPath: (rel) => ipcRenderer.send('app:reveal', rel),
    contextMenu: (items) => ipcRenderer.invoke('app:context-menu', items),
    messageBox: (options) => ipcRenderer.invoke('app:message-box', options),
    setZoom: (level) => ipcRenderer.send('app:zoom', level),
    checkUpdate: () => ipcRenderer.invoke('app:check-update')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChanged: (cb) => subscribe('settings:changed', cb)
  },
  workspace: {
    pickFolder: () => ipcRenderer.invoke('ws:pick'),
    open: (root) => ipcRenderer.invoke('ws:open', root),
    close: () => ipcRenderer.invoke('ws:close'),
    current: () => ipcRenderer.invoke('ws:current'),
    recent: () => ipcRenderer.invoke('ws:recent'),
    forgetRecent: (root) => ipcRenderer.invoke('ws:forget-recent', root),
    listDir: (rel) => ipcRenderer.invoke('ws:list-dir', rel),
    listFiles: () => ipcRenderer.invoke('ws:list-files'),
    readFile: (rel) => ipcRenderer.invoke('ws:read', rel),
    writeFile: (rel, content, opts) => ipcRenderer.invoke('ws:write', rel, content, opts),
    canonical: (rel) => ipcRenderer.invoke('ws:canonical', rel),
    exists: (rel) => ipcRenderer.invoke('ws:exists', rel),
    createFile: (rel) => ipcRenderer.invoke('ws:create-file', rel),
    createDir: (rel) => ipcRenderer.invoke('ws:create-dir', rel),
    rename: (from, to) => ipcRenderer.invoke('ws:rename', from, to),
    trash: (rel) => ipcRenderer.invoke('ws:trash', rel),
    search: (options) => ipcRenderer.invoke('ws:search', options),
    gitBranch: () => ipcRenderer.invoke('ws:git-branch'),
    loadState: () => ipcRenderer.invoke('ws:load-state'),
    saveState: (state) => ipcRenderer.invoke('ws:save-state', state),
    onChanged: (cb) => subscribe<[string[]]>('ws:changed', cb)
  },
  llm: {
    providerStatus: () => ipcRenderer.invoke('llm:status'),
    listModels: () => ipcRenderer.invoke('llm:models'),
    loaded: () => ipcRenderer.invoke('llm:loaded'),
    chat: (id, request) => ipcRenderer.send('llm:chat', id, request),
    onChatEvent: (id, cb) => subscribeFor('llm:event', id, cb),
    abort: (id) => ipcRenderer.send('llm:abort', id),
    complete: (id, request) => ipcRenderer.invoke('llm:complete', id, request),
    pull: (id, providerId, name) => ipcRenderer.send('llm:pull', id, providerId, name),
    onPullProgress: (id, cb) => subscribeFor('llm:pull-progress', id, cb),
    warm: (modelId, keepAlive) => ipcRenderer.invoke('llm:warm', modelId, keepAlive),
    unload: (modelId) => ipcRenderer.invoke('llm:unload', modelId)
  },
  terminal: {
    create: (opts) => ipcRenderer.invoke('term:create', opts),
    write: (id, data) => ipcRenderer.send('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('term:kill', id),
    onData: (id, cb) => subscribeFor('term:data', id, cb),
    onExit: (id, cb) => subscribeFor('term:exit', id, cb)
  },
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    showHead: (rel) => ipcRenderer.invoke('git:show-head', rel),
    stage: (paths) => ipcRenderer.invoke('git:stage', paths),
    unstage: (paths) => ipcRenderer.invoke('git:unstage', paths),
    discard: (paths) => ipcRenderer.invoke('git:discard', paths),
    commit: (message, all) => ipcRenderer.invoke('git:commit', message, all),
    push: () => ipcRenderer.invoke('git:push'),
    pull: () => ipcRenderer.invoke('git:pull'),
    fetch: () => ipcRenderer.invoke('git:fetch'),
    init: () => ipcRenderer.invoke('git:init'),
    summary: () => ipcRenderer.invoke('git:summary')
  },
  exec: {
    run: (id, command, cwdRel) => ipcRenderer.invoke('exec:run', id, command, cwdRel),
    onOutput: (id, cb) => subscribeFor('exec:output', id, cb),
    abort: (id) => ipcRenderer.send('exec:abort', id)
  }
}

contextBridge.exposeInMainWorld('hearth', api)
