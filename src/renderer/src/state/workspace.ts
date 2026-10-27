import { create } from 'zustand'
import type { DirEntry, WorkspaceInfo } from '../../../shared/types'
import { api } from '../api'
import { dirname, isUnder } from '../lib/paths'
import { toast } from './ui'

interface WorkspaceStore {
  info: WorkspaceInfo | null
  branch: string | null
  children: Record<string, DirEntry[] | undefined>
  expanded: Record<string, boolean>
  selected: string | null
  files: string[] | null
  filesTruncated: boolean
  editing: { kind: 'rename'; path: string } | { kind: 'new-file' | 'new-dir'; parent: string } | null
  setInfo(info: WorkspaceInfo | null): void
  loadDir(rel: string): Promise<void>
  toggle(rel: string): void
  expandTo(path: string): Promise<void>
  select(path: string | null): void
  ensureFiles(force?: boolean): Promise<string[]>
  refreshBranch(): Promise<void>
  onFsChanged(paths: string[]): void
  startEdit(edit: WorkspaceStore['editing']): void
}

let filesPromise: Promise<string[]> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  info: null,
  branch: null,
  children: {},
  expanded: {},
  selected: null,
  files: null,
  filesTruncated: false,
  editing: null,

  setInfo(info) {
    filesPromise = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    set({ info, branch: null, children: {}, expanded: {}, selected: null, files: null, editing: null })
    if (info) {
      void get().loadDir('')
      void get().refreshBranch()
    }
  },

  async loadDir(rel) {
    if (!get().info) return
    try {
      const entries = await api.workspace.listDir(rel)
      set({ children: { ...get().children, [rel]: entries } })
    } catch {
      const next = { ...get().children }
      delete next[rel]
      set({ children: next })
    }
  },

  toggle(rel) {
    const open = !get().expanded[rel]
    set({ expanded: { ...get().expanded, [rel]: open } })
    if (open && !get().children[rel]) void get().loadDir(rel)
  },

  async expandTo(path) {
    const parts = path.split('/')
    const expanded = { ...get().expanded }
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      expanded[acc] = true
      if (!get().children[acc]) await get().loadDir(acc)
    }
    set({ expanded, selected: path })
  },

  select(path) {
    set({ selected: path })
  },

  ensureFiles(force = false) {
    if (!force && get().files) return Promise.resolve(get().files!)
    if (filesPromise && !force) return filesPromise
    filesPromise = api.workspace
      .listFiles()
      .then(({ files, truncated }) => {
        set({ files, filesTruncated: truncated })
        return files
      })
      .catch(() => [] as string[])
      .finally(() => {
        filesPromise = null
      })
    return filesPromise
  },

  async refreshBranch() {
    try {
      set({ branch: await api.workspace.gitBranch() })
    } catch {
      set({ branch: null })
    }
  },

  onFsChanged(paths) {
    const { children } = get()
    const dirs = new Set<string>()
    let reloadAll = false
    for (const p of paths) {
      if (p === '') reloadAll = true
      if (p === '.git/HEAD') {
        void get().refreshBranch()
        continue
      }
      dirs.add(dirname(p))
      if (children[p] !== undefined) dirs.add(p)
    }
    const targets = reloadAll ? Object.keys(children) : [...dirs].filter((d) => children[d] !== undefined)
    for (const d of targets) void get().loadDir(d)
    if (get().files && paths.some((p) => p !== '.git/HEAD')) {
      // Keep the current list usable and refresh it quietly.
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (get().info) void get().ensureFiles(true)
      }, 800)
    }
  },

  startEdit(editing) {
    set({ editing })
    if (editing && editing.kind !== 'rename' && editing.parent) {
      set({ expanded: { ...get().expanded, [editing.parent]: true } })
      if (!get().children[editing.parent]) void get().loadDir(editing.parent)
    }
  }
}))

export async function createEntry(parent: string, name: string, kind: 'file' | 'dir'): Promise<string | null> {
  const clean = name.trim().replace(/\\/g, '/')
  if (!clean) return null
  const path = parent ? `${parent}/${clean}` : clean
  try {
    if (kind === 'dir') await api.workspace.createDir(path)
    else await api.workspace.createFile(path)
    await useWorkspace.getState().loadDir(dirname(path))
    return path
  } catch (err) {
    toast((err as Error).message, 'error')
    return null
  }
}

export function isExpandedUnder(path: string, dir: string): boolean {
  return isUnder(path, dir)
}
