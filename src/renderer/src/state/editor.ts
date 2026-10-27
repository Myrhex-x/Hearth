import { create } from 'zustand'
import { api } from '../api'
import { languageFor, monaco, uriFor } from '../lib/monaco'
import { basename } from '../lib/paths'
import { rememberRecentFile } from '../lib/recent'
import { useWorkspace } from './workspace'
import { toast } from './ui'

export type TabKind = 'file' | 'diff' | 'image' | 'binary' | 'large'

export interface Tab {
  id: string
  kind: TabKind
  path: string
  title: string
  preview: boolean
  dirty: boolean
  imageUrl?: string
  size?: number
  diffLabel?: string
}

interface Entry {
  model: monaco.editor.ITextModel
  savedVersion: number
  bom: boolean
  encoding: 'utf8' | 'utf16le'
  viewState: monaco.editor.ICodeEditorViewState | null
  listener: monaco.IDisposable
}

const entries = new Map<string, Entry>()
const diffModels = new Map<string, { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel }>()

/** The live Monaco instances, set by the editor component. */
export const editorHost: {
  editor: monaco.editor.IStandaloneCodeEditor | null
  diff: monaco.editor.IStandaloneDiffEditor | null
} = { editor: null, diff: null }

interface OpenOptions {
  preview?: boolean
  line?: number
  column?: number
  endLine?: number
  focus?: boolean
}

interface EditorStore {
  tabs: Tab[]
  activeId: string | null
  openFile(path: string, opts?: OpenOptions): Promise<void>
  openDiff(path: string, original: string, label: string): Promise<void>
  setActive(id: string): void
  pin(id: string): void
  closeTab(id: string): Promise<boolean>
  closeAll(force?: boolean): Promise<boolean>
  save(path?: string): Promise<void>
  saveAll(): Promise<void>
  cycle(dir: 1 | -1): void
  setDirty(path: string, dirty: boolean): void
}

export function getEntry(path: string): Entry | undefined {
  return entries.get(path)
}

export function activeTab(): Tab | undefined {
  const { tabs, activeId } = useEditor.getState()
  return tabs.find((t) => t.id === activeId)
}

let pendingReveal: { path: string; opts: OpenOptions } | null = null

function applyReveal(ed: monaco.editor.IStandaloneCodeEditor, opts: OpenOptions): void {
  const line = Math.max(1, opts.line!)
  const col = Math.max(1, opts.column ?? 1)
  ed.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Immediate)
  if (opts.endLine && opts.endLine >= line) {
    ed.setSelection(new monaco.Selection(line, 1, opts.endLine, ed.getModel()?.getLineMaxColumn(opts.endLine) ?? 1))
  } else ed.setPosition({ lineNumber: line, column: col })
}

function reveal(path: string, opts?: OpenOptions): void {
  if (!opts?.line) return
  const ed = editorHost.editor
  const entry = entries.get(path)
  // A file that is not on screen yet gets its model after React renders: finish in revealPending.
  if (!ed || !entry || ed.getModel() !== entry.model) {
    pendingReveal = { path, opts }
    return
  }
  pendingReveal = null
  applyReveal(ed, opts)
}

/** Called by the editor once it shows a file, to go to the line it was opened for. */
export function revealPending(path: string): void {
  const ed = editorHost.editor
  if (!ed || pendingReveal?.path !== path) return
  const { opts } = pendingReveal
  pendingReveal = null
  // The editor stays hidden until the first file opens: measure it now, or the scroll is lost.
  ed.layout()
  applyReveal(ed, opts)
}

async function loadEntry(path: string): Promise<Tab> {
  const file = await api.workspace.readFile(path)
  const title = basename(path)
  if (file.imageDataUrl && file.binary) return { id: path, kind: 'image', path, title, preview: false, dirty: false, imageUrl: file.imageDataUrl, size: file.size }
  if (file.tooLarge) return { id: path, kind: 'large', path, title, preview: false, dirty: false, size: file.size }
  if (file.binary) return { id: path, kind: 'binary', path, title, preview: false, dirty: false, size: file.size }
  let entry = entries.get(path)
  if (!entry) {
    const uri = uriFor(path)
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(file.content, languageFor(path), uri)
    const created: Entry = {
      model,
      savedVersion: model.getAlternativeVersionId(),
      bom: file.bom,
      encoding: file.encoding ?? 'utf8',
      viewState: null,
      listener: model.onDidChangeContent(() => {
        const dirty = model.getAlternativeVersionId() !== created.savedVersion
        useEditor.getState().setDirty(path, dirty)
      })
    }
    entries.set(path, created)
    entry = created
  }
  return { id: path, kind: 'file', path, title, preview: false, dirty: false }
}

function disposeEntry(path: string): void {
  const e = entries.get(path)
  if (!e) return
  e.listener.dispose()
  e.model.dispose()
  entries.delete(path)
}

function disposeDiff(id: string): void {
  const d = diffModels.get(id)
  if (!d) return
  d.original.dispose()
  d.modified.dispose()
  diffModels.delete(id)
}

function saveViewState(): void {
  const { activeId, tabs } = useEditor.getState()
  const tab = tabs.find((t) => t.id === activeId)
  if (tab?.kind === 'file' && editorHost.editor) {
    const e = entries.get(tab.path)
    if (e) e.viewState = editorHost.editor.saveViewState()
  }
}

export const useEditor = create<EditorStore>((set, get) => ({
  tabs: [],
  activeId: null,

  async openFile(path, opts) {
    rememberRecentFile(path)
    const existing = get().tabs.find((t) => t.id === path)
    if (existing) {
      saveViewState()
      const tabs = opts?.preview === false && existing.preview ? get().tabs.map((t) => (t.id === path ? { ...t, preview: false } : t)) : get().tabs
      set({ activeId: path, tabs })
      reveal(path, opts)
      void useWorkspace.getState().expandTo(path)
      return
    }
    let tab: Tab
    try {
      tab = await loadEntry(path)
    } catch (err) {
      toast(`Could not open ${path}: ${(err as Error).message}`, 'error')
      return
    }
    saveViewState()
    const preview = opts?.preview ?? false
    let tabs = [...get().tabs]
    const activeIndex = tabs.findIndex((t) => t.id === get().activeId)
    const previewIndex = preview ? tabs.findIndex((t) => t.preview && !t.dirty) : -1
    const next = { ...tab, preview }
    if (previewIndex >= 0) {
      const old = tabs[previewIndex]
      tabs[previewIndex] = next
      if (old.kind === 'file' && !tabs.some((t) => t.path === old.path && t.id !== old.id)) disposeEntry(old.path)
    } else tabs.splice(activeIndex + 1, 0, next)
    tabs = tabs.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)
    set({ tabs, activeId: path })
    reveal(path, opts)
    void useWorkspace.getState().expandTo(path)
  },

  async openDiff(path, original, label) {
    const id = `diff:${path}`
    disposeDiff(id)
    let current = ''
    const entry = entries.get(path)
    if (entry) current = entry.model.getValue()
    else {
      try {
        current = (await api.workspace.readFile(path)).content
      } catch {
        current = ''
      }
    }
    const lang = languageFor(path)
    diffModels.set(id, {
      original: monaco.editor.createModel(original, lang),
      modified: monaco.editor.createModel(current, lang)
    })
    saveViewState()
    const tab: Tab = { id, kind: 'diff', path, title: basename(path), preview: false, dirty: false, diffLabel: label }
    const tabs = get().tabs.filter((t) => t.id !== id)
    const at = tabs.findIndex((t) => t.id === get().activeId)
    tabs.splice(at + 1, 0, tab)
    set({ tabs, activeId: id })
  },

  setActive(id) {
    if (id === get().activeId) return
    saveViewState()
    set({ activeId: id })
  },

  pin(id) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) })
  },

  async closeTab(id) {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return true
    if (tab.kind === 'file' && tab.dirty) {
      const choice = await api.app.messageBox({
        type: 'warning',
        message: `Save the changes you made to ${tab.title}?`,
        detail: 'Your changes will be lost if you close without saving.',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2
      })
      if (choice === 2) return false
      if (choice === 0) await get().save(tab.path)
    }
    if (id === get().activeId) saveViewState()
    const tabs = get().tabs
    const index = tabs.findIndex((t) => t.id === id)
    const remaining = tabs.filter((t) => t.id !== id)
    let activeId = get().activeId
    if (activeId === id) activeId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null
    set({ tabs: remaining, activeId })
    if (tab.kind === 'diff') disposeDiff(id)
    else if (tab.kind === 'file') disposeEntry(tab.path)
    return true
  },

  async closeAll(force = false) {
    if (!force) {
      const dirty = get().tabs.filter((t) => t.dirty)
      if (dirty.length) {
        const choice = await api.app.messageBox({
          type: 'warning',
          message: dirty.length === 1 ? `Save the changes you made to ${dirty[0].title}?` : `Save the changes you made to ${dirty.length} files?`,
          detail: 'Your changes will be lost if you close without saving.',
          buttons: ['Save All', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2
        })
        if (choice === 2) return false
        if (choice === 0) await get().saveAll()
      }
    }
    for (const t of get().tabs) {
      if (t.kind === 'diff') disposeDiff(t.id)
      else if (t.kind === 'file') disposeEntry(t.path)
    }
    set({ tabs: [], activeId: null })
    return true
  },

  async save(path) {
    const target = path ?? activeTab()?.path
    if (!target) return
    const entry = entries.get(target)
    if (!entry) return
    const version = entry.model.getAlternativeVersionId()
    try {
      await api.workspace.writeFile(target, entry.model.getValue(), { bom: entry.bom, encoding: entry.encoding })
      entry.savedVersion = version
      get().setDirty(target, entry.model.getAlternativeVersionId() !== version)
      get().pin(target)
    } catch (err) {
      toast(`Could not save ${target}: ${(err as Error).message}`, 'error')
    }
  },

  async saveAll() {
    for (const t of get().tabs) if (t.kind === 'file' && t.dirty) await get().save(t.path)
  },

  cycle(dir) {
    const { tabs, activeId } = get()
    if (tabs.length < 2) return
    const i = tabs.findIndex((t) => t.id === activeId)
    const next = tabs[(i + dir + tabs.length) % tabs.length]
    get().setActive(next.id)
  },

  setDirty(path, dirty) {
    const tabs = get().tabs
    const t = tabs.find((x) => x.id === path)
    if (!t || (t.dirty === dirty && !(dirty && t.preview))) return
    set({ tabs: tabs.map((x) => (x.id === path ? { ...x, dirty, preview: dirty ? false : x.preview } : x)) })
  }
}))

export function diffModelsFor(id: string) {
  return diffModels.get(id)
}

export function viewStateFor(path: string): monaco.editor.ICodeEditorViewState | null {
  return entries.get(path)?.viewState ?? null
}

/** Text of a file as the person currently sees it (unsaved edits included). */
export function openText(path: string): string | null {
  const e = entries.get(path)
  return e ? e.model.getValue() : null
}

/** Smallest single replacement turning `a` into `b`. */
export function minimalEdit(a: string, b: string): { start: number; end: number; text: string } | null {
  if (a === b) return null
  let start = 0
  const max = Math.min(a.length, b.length)
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  return { start, end: endA, text: b.slice(start, endB) }
}

function applyToModel(model: monaco.editor.ITextModel, next: string): monaco.Range | null {
  const eol = model.getEOL()
  const target = eol === '\r\n' ? next.replace(/\r?\n/g, '\r\n') : next.replace(/\r\n/g, '\n')
  const edit = minimalEdit(model.getValue(), target)
  if (!edit) return null
  const range = monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end))
  model.pushStackElement()
  model.pushEditOperations([], [{ range, text: edit.text }], () => null)
  model.pushStackElement()
  const end = model.getPositionAt(edit.start + edit.text.length)
  return monaco.Range.fromPositions(model.getPositionAt(edit.start), end)
}

const flashIds = new Map<string, string[]>()

function flash(path: string, model: monaco.editor.ITextModel, range: monaco.Range): void {
  const ed = editorHost.editor
  if (!ed || ed.getModel() !== model) return
  const old = flashIds.get(path) ?? []
  const ids = model.deltaDecorations(old, [
    { range: new monaco.Range(range.startLineNumber, 1, range.endLineNumber, 1), options: { isWholeLine: true, className: 'hearth-flash-line' } }
  ])
  flashIds.set(path, ids)
  setTimeout(() => {
    if (!model.isDisposed()) model.deltaDecorations(ids, [])
  }, 2400)
}

/**
 * Writes new content for a file the agent changed: through the open buffer when
 * the file is open (so undo still works), then to disk.
 */
export async function writeFileContent(path: string, content: string): Promise<void> {
  const entry = entries.get(path)
  if (entry) {
    const range = applyToModel(entry.model, content)
    await api.workspace.writeFile(path, entry.model.getValue(), { bom: entry.bom, encoding: entry.encoding })
    entry.savedVersion = entry.model.getAlternativeVersionId()
    useEditor.getState().setDirty(path, false)
    if (range) flash(path, entry.model, range)
  } else {
    // Keep a byte order mark or UTF-16 encoding the file already has (Visual Studio and PowerShell files).
    let opts: { bom?: boolean; encoding?: 'utf8' | 'utf16le' } | undefined
    try {
      if ((await api.workspace.exists(path)) === 'file') {
        const current = await api.workspace.readFile(path)
        opts = { bom: current.bom, encoding: current.encoding }
      }
    } catch {
      opts = undefined
    }
    await api.workspace.writeFile(path, content, opts)
  }
}

/** Keeps open, unmodified files in step with changes made outside the editor. */
export async function syncFromDisk(paths: string[]): Promise<void> {
  for (const path of paths) {
    const entry = entries.get(path)
    if (!entry) continue
    const tab = useEditor.getState().tabs.find((t) => t.id === path)
    if (tab?.dirty) continue
    try {
      const file = await api.workspace.readFile(path)
      if (file.binary || file.tooLarge) continue
      if (entry.model.isDisposed()) continue
      const current = entry.model.getValue()
      const normalized = entry.model.getEOL() === '\r\n' ? file.content.replace(/\r?\n/g, '\r\n') : file.content.replace(/\r\n/g, '\n')
      if (current === normalized) continue
      applyToModel(entry.model, file.content)
      entry.savedVersion = entry.model.getAlternativeVersionId()
      useEditor.getState().setDirty(path, false)
    } catch {
      // deleted: leave the buffer as it is so nothing is lost
    }
  }
}

export function renameOpenPath(from: string, to: string): void {
  const { tabs } = useEditor.getState()
  if (!tabs.some((t) => t.path === from || t.path.startsWith(from + '/'))) return
  // Reopen renamed files under their new path; their buffers were saved by the rename flow.
  const affected = tabs.filter((t) => t.kind === 'file' && (t.path === from || t.path.startsWith(from + '/')))
  for (const t of affected) {
    const newPath = to + t.path.slice(from.length)
    disposeEntry(t.path)
    void useEditor.getState().closeTab(t.id).then(() => useEditor.getState().openFile(newPath))
  }
}

/** Treats the current buffer as saved (used after an inline edit is undone). */
export function markClean(path: string): void {
  const e = entries.get(path)
  if (!e) return
  e.savedVersion = e.model.getAlternativeVersionId()
  useEditor.getState().setDirty(path, false)
}
