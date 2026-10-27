import type { WorkspaceInfo } from '../../../shared/types'
import { api } from '../api'
import type { ChatThread } from '../agent/types'
import { useChat } from './chat'
import { useGit } from './git'
import { useEditor } from './editor'
import { toast } from './ui'
import { useWorkspace } from './workspace'

// Opening and closing projects, and remembering per-project state between launches.

interface PersistedState {
  version: 1
  tabs: string[]
  active: string | null
  expanded: string[]
  threads: ChatThread[]
  activeThread: string | null
}

let restoring = false
let saveTimer: number | null = null

function snapshot(): PersistedState {
  const editor = useEditor.getState()
  const ws = useWorkspace.getState()
  const chat = useChat.getState()
  return {
    version: 1,
    tabs: editor.tabs.filter((t) => t.kind !== 'diff' && !t.preview).map((t) => t.path),
    active: editor.tabs.find((t) => t.id === editor.activeId && t.kind !== 'diff')?.path ?? null,
    expanded: Object.keys(ws.expanded).filter((k) => ws.expanded[k]),
    threads: [...chat.threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40),
    activeThread: chat.activeId
  }
}

function scheduleSave(): void {
  if (restoring || !useWorkspace.getState().info) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    if (!useWorkspace.getState().info) return
    void api.workspace.saveState(snapshot()).catch(() => {})
  }, 700)
}

export function startPersistence(): void {
  useEditor.subscribe((s, p) => {
    if (s.tabs !== p.tabs || s.activeId !== p.activeId) scheduleSave()
  })
  useWorkspace.subscribe((s, p) => {
    if (s.expanded !== p.expanded) scheduleSave()
  })
  useChat.subscribe((s, p) => {
    if (s.threads !== p.threads || s.activeId !== p.activeId) scheduleSave()
  })
  window.addEventListener('beforeunload', () => {
    if (useWorkspace.getState().info) void api.workspace.saveState(snapshot())
  })
}

async function apply(info: WorkspaceInfo): Promise<void> {
  restoring = true
  try {
    useWorkspace.getState().setInfo(info)
    useGit.getState().reset()
    void useGit.getState().refresh()
    let state: PersistedState | null = null
    try {
      state = (await api.workspace.loadState()) as PersistedState | null
    } catch {
      state = null
    }
    useChat.getState().load(state?.threads ?? [], state?.activeThread ?? null)
    if (state?.expanded?.length) {
      const expanded: Record<string, boolean> = {}
      for (const d of state.expanded) expanded[d] = true
      useWorkspace.setState({ expanded })
      for (const d of state.expanded) void useWorkspace.getState().loadDir(d)
    }
    for (const path of state?.tabs ?? []) {
      if ((await api.workspace.exists(path)) === 'file') await useEditor.getState().openFile(path, { preview: false })
    }
    if (state?.active && useEditor.getState().tabs.some((t) => t.id === state!.active)) useEditor.getState().setActive(state.active)
  } finally {
    restoring = false
  }
}

async function leaveCurrent(): Promise<boolean> {
  if (!(await useEditor.getState().closeAll())) return false
  if (useChat.getState().runningThread) useChat.getState().stop()
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  return true
}

export async function openFolder(root?: string): Promise<void> {
  const hadWorkspace = !!useWorkspace.getState().info
  if (hadWorkspace) {
    await api.workspace.saveState(snapshot()).catch(() => {})
    if (!(await leaveCurrent())) return
  }
  try {
    const info = root ? await api.workspace.open(root) : await api.workspace.pickFolder()
    if (!info) {
      if (hadWorkspace) {
        const current = await api.workspace.current()
        if (current) await apply(current)
      }
      return
    }
    await apply(info)
  } catch (err) {
    toast(`Could not open the folder: ${(err as Error).message}`, 'error')
  }
}

export async function closeFolder(): Promise<void> {
  if (!useWorkspace.getState().info) return
  await api.workspace.saveState(snapshot()).catch(() => {})
  if (!(await leaveCurrent())) return
  await api.workspace.close()
  useGit.getState().reset()
  useWorkspace.getState().setInfo(null)
  useChat.getState().load([], null)
}

export async function restoreLastFolder(last: string | null): Promise<void> {
  if (!last) return
  try {
    const info = await api.workspace.open(last)
    await apply(info)
  } catch {
    // The folder moved or was deleted: stay on the welcome screen.
  }
}

/** Flushes state and lets the window close once unsaved files are handled. */
export async function handleCloseRequest(): Promise<void> {
  if (useWorkspace.getState().info) await api.workspace.saveState(snapshot()).catch(() => {})
  const dirty = useEditor.getState().tabs.filter((t) => t.dirty)
  if (dirty.length) {
    const ok = await useEditor.getState().closeAll()
    if (!ok) {
      api.app.cancelClose()
      return
    }
  }
  if (useChat.getState().runningThread) useChat.getState().stop()
  api.app.confirmClose()
}
