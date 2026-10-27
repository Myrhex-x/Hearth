import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { CaseSensitive, ChevronRight, FilePlus2, Folder, FolderPlus, GitCompareArrows, Regex, RotateCw, Search, WholeWord } from 'lucide-react'
import type { DirEntry, SearchResult } from '../../../shared/types'
import { api, isMac, isWin } from '../api'
import { useChat } from '../state/chat'
import { renameOpenPath, useEditor } from '../state/editor'
import { useUi, toast } from '../state/ui'
import { createEntry, useWorkspace } from '../state/workspace'
import { gitLetter, useGit } from '../state/git'
import { ChangesPanel, useGitBadge } from './ChangesPanel'
import { MeaningSearch } from './MeaningSearch'
import { basename, dirname } from '../lib/paths'
import { shortcutLabel } from '../lib/keys'
import { FileIcon, IconButton, Segmented, Spinner, cx } from './ui'

export function Sidebar() {
  const tab = useUi((s) => s.sidebarTab)
  const changes = useGitBadge()
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => useUi.setState({ sidebarTab: v })}
          options={[
            { value: 'files', label: <Folder size={14} strokeWidth={1.8} />, title: 'Files' },
            { value: 'search', label: <Search size={14} strokeWidth={1.9} />, title: `Search  ${shortcutLabel('mod+shift+f')}` },
            {
              value: 'changes',
              title: `Changes  ${shortcutLabel('ctrl+shift+g')}`,
              label: (
                <>
                  <GitCompareArrows size={14} strokeWidth={1.8} />
                  {changes > 0 && <span className="segment-badge">{changes > 99 ? '99+' : changes}</span>}
                </>
              )
            }
          ]}
        />
        {tab === 'files' && <TreeActions />}
      </div>
      {tab === 'files' ? <FileTree /> : tab === 'search' ? <SearchPanel /> : <ChangesPanel />}
    </aside>
  )
}

function TreeActions() {
  const startEdit = useWorkspace((s) => s.startEdit)
  const parent = () => {
    const ws = useWorkspace.getState()
    const sel = ws.selected
    if (!sel) return ''
    return ws.children[sel] !== undefined ? sel : dirname(sel)
  }
  return (
    <div className="tree-actions">
      <IconButton label="New file" onClick={() => startEdit({ kind: 'new-file', parent: parent() })}>
        <FilePlus2 size={14} strokeWidth={1.7} />
      </IconButton>
      <IconButton label="New folder" onClick={() => startEdit({ kind: 'new-dir', parent: parent() })}>
        <FolderPlus size={14} strokeWidth={1.7} />
      </IconButton>
      <IconButton label="Refresh" onClick={() => {
        const ws = useWorkspace.getState()
        for (const d of Object.keys(ws.children)) void ws.loadDir(d)
      }}>
        <RotateCw size={13} strokeWidth={1.8} />
      </IconButton>
    </div>
  )
}

interface Row {
  entry: DirEntry
  depth: number
}

function NameInput({ initial, onDone, depth, kind }: { initial: string; depth: number; kind: 'file' | 'dir'; onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    const dot = initial.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 && kind === 'file' ? dot : initial.length)
  }, [initial, kind])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <div className="tree-row is-editing" style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="tree-chevron" />
      <FileIcon path={initial || 'file'} dir={kind === 'dir'} />
      <input
        ref={ref}
        className="tree-input"
        defaultValue={initial}
        spellCheck={false}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') finish(e.currentTarget.value)
          if (e.key === 'Escape') finish(null)
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  )
}

async function rowMenu(entry: DirEntry): Promise<void> {
  const ws = useWorkspace.getState()
  const isDir = entry.kind === 'dir'
  const parent = isDir ? entry.path : dirname(entry.path)
  const choice = await api.app.contextMenu([
    { id: 'new-file', label: 'New File…' },
    { id: 'new-dir', label: 'New Folder…' },
    { type: 'separator' },
    ...(!isDir ? [{ id: 'chat', label: 'Add to Chat' }, { type: 'separator' as const }] : []),
    { id: 'rename', label: 'Rename…' },
    { id: 'trash', label: isWin ? 'Delete' : 'Move to Trash' },
    { type: 'separator' },
    { id: 'copy-rel', label: 'Copy Relative Path' },
    { id: 'copy', label: 'Copy Path' },
    { id: 'reveal', label: isMac ? 'Reveal in Finder' : isWin ? 'Show in File Explorer' : 'Show in Files' }
  ])
  if (!choice) return
  switch (choice) {
    case 'new-file':
      ws.startEdit({ kind: 'new-file', parent })
      break
    case 'new-dir':
      ws.startEdit({ kind: 'new-dir', parent })
      break
    case 'chat':
      useChat.getState().addChip({ kind: 'file', path: entry.path })
      useUi.getState().focusChat()
      break
    case 'rename':
      ws.startEdit({ kind: 'rename', path: entry.path })
      break
    case 'trash': {
      const ok = await api.app.messageBox({
        type: 'warning',
        message: `Move “${entry.name}” to the ${isWin ? 'Recycle Bin' : 'Trash'}?`,
        detail: isDir ? 'The folder and everything in it will be moved.' : undefined,
        buttons: [isWin ? 'Delete' : 'Move to Trash', 'Cancel'],
        defaultId: 0,
        cancelId: 1
      })
      if (ok !== 0) return
      try {
        for (const t of useEditor.getState().tabs) if (t.path === entry.path || t.path.startsWith(entry.path + '/')) await useEditor.getState().closeTab(t.id)
        await api.workspace.trash(entry.path)
        await ws.loadDir(dirname(entry.path))
      } catch (err) {
        toast((err as Error).message, 'error')
      }
      break
    }
    case 'copy-rel':
      void navigator.clipboard.writeText(entry.path)
      break
    case 'copy': {
      const sep = isWin ? '\\' : '/'
      const root = (ws.info?.root ?? '').replace(/[\\/]+$/, '')
      void navigator.clipboard.writeText(root + sep + entry.path.split('/').join(sep))
      break
    }
    case 'reveal':
      api.app.revealPath(entry.path)
      break
  }
}

async function finishRename(path: string, value: string | null): Promise<void> {
  const ws = useWorkspace.getState()
  ws.startEdit(null)
  const name = value?.trim()
  if (!name || name === basename(path)) return
  const to = dirname(path) ? `${dirname(path)}/${name}` : name
  try {
    for (const t of useEditor.getState().tabs) if ((t.path === path || t.path.startsWith(path + '/')) && t.dirty) await useEditor.getState().save(t.path)
    await api.workspace.rename(path, to)
    renameOpenPath(path, to)
    await ws.loadDir(dirname(path))
    ws.select(to)
  } catch (err) {
    toast((err as Error).message, 'error')
  }
}

function FileTree() {
  const { children, expanded, selected, editing, info } = useWorkspace()
  const toggle = useWorkspace((s) => s.toggle)
  const select = useWorkspace((s) => s.select)
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const openFile = useEditor((s) => s.openFile)
  const listRef = useRef<HTMLDivElement>(null)
  const dirty = useMemo(() => new Set(tabs.filter((t) => t.dirty).map((t) => t.path)), [tabs])
  const gitByPath = useGit((s) => s.byPath)
  const changedDirs = useGit((s) => s.changedDirs)

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number) => {
      for (const entry of children[dir] ?? []) {
        out.push({ entry, depth })
        if (entry.kind === 'dir' && expanded[entry.path]) walk(entry.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [children, expanded])

  const activate = (entry: DirEntry, pin = false) => {
    select(entry.path)
    if (entry.kind === 'dir') toggle(entry.path)
    else void openFile(entry.path, { preview: !pin })
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (editing) return
    const i = rows.findIndex((r) => r.entry.path === selected)
    const cur = rows[i]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        select(next.entry.path)
        listRef.current?.querySelector(`[data-path="${CSS.escape(next.entry.path)}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    } else if (e.key === 'ArrowRight' && cur?.entry.kind === 'dir' && !expanded[cur.entry.path]) toggle(cur.entry.path)
    else if (e.key === 'ArrowLeft' && cur) {
      if (cur.entry.kind === 'dir' && expanded[cur.entry.path]) toggle(cur.entry.path)
      else if (dirname(cur.entry.path)) select(dirname(cur.entry.path))
    } else if (e.key === 'Enter' && cur) {
      e.preventDefault()
      if (isMac && cur.entry.kind === 'file') useWorkspace.getState().startEdit({ kind: 'rename', path: cur.entry.path })
      else activate(cur.entry, true)
    } else if (e.key === 'F2' && cur) useWorkspace.getState().startEdit({ kind: 'rename', path: cur.entry.path })
  }

  const newRow = (parent: string, depth: number) =>
    editing && editing.kind !== 'rename' && editing.parent === parent ? (
      <NameInput
        key="__new"
        initial=""
        depth={depth}
        kind={editing.kind === 'new-dir' ? 'dir' : 'file'}
        onDone={async (v) => {
          useWorkspace.getState().startEdit(null)
          if (!v?.trim()) return
          const path = await createEntry(parent, v, editing.kind === 'new-dir' ? 'dir' : 'file')
          if (path && editing.kind === 'new-file') void openFile(path, { preview: false })
          if (path) select(path)
        }}
      />
    ) : null

  if (!info) return null
  const items: ReactNode[] = [newRow('', 0)]
  for (const { entry, depth } of rows) {
    if (editing?.kind === 'rename' && editing.path === entry.path) {
      items.push(<NameInput key={entry.path} initial={entry.name} depth={depth} kind={entry.kind} onDone={(v) => void finishRename(entry.path, v)} />)
    } else {
      const open = entry.kind === 'dir' && !!expanded[entry.path]
      const g = entry.kind === 'file' ? gitByPath.get(entry.path) : undefined
      items.push(
        <div
          key={entry.path}
          data-path={entry.path}
          className={cx('tree-row', selected === entry.path && 'is-selected', activeId === entry.path && 'is-active', entry.ignored && 'is-ignored', g && `git-${g.kind}`)}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => activate(entry)}
          onDoubleClick={() => entry.kind === 'file' && void openFile(entry.path, { preview: false })}
          onContextMenu={(e) => {
            e.preventDefault()
            select(entry.path)
            void rowMenu(entry)
          }}
          title={entry.path}
        >
          <span className={cx('tree-chevron', open && 'is-open')}>{entry.kind === 'dir' && <ChevronRight size={12} strokeWidth={2} />}</span>
          <FileIcon path={entry.name} dir={entry.kind === 'dir'} open={open} />
          <span className="tree-name">{entry.name}</span>
          {dirty.has(entry.path) && <span className="tree-dirty" />}
          {g && <span className="tree-git">{gitLetter(g)}</span>}
          {entry.kind === 'dir' && !open && changedDirs.has(entry.path) && <span className="tree-git-dot" />}
        </div>
      )
    }
    if (entry.kind === 'dir' && expanded[entry.path]) {
      const nr = newRow(entry.path, depth + 1)
      if (nr) items.push(nr)
    }
  }

  return (
    <div className="tree" ref={listRef} tabIndex={0} onKeyDown={onKey}>
      {items}
      {rows.length === 0 && !editing && <div className="tree-empty">This folder is empty.</div>}
    </div>
  )
}

function SearchPanel() {
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false })
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const tick = useUi((s) => s.searchFocusTick)
  const mode = useUi((s) => s.searchMode)
  const openFile = useEditor((s) => s.openFile)
  const seq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [tick])

  useEffect(() => {
    if (!query.trim() || mode !== 'exact') {
      setResult(null)
      return
    }
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await api.workspace.search({ query, ...opts, maxResults: 800 })
        if (id === seq.current) setResult(res)
      } finally {
        if (id === seq.current) setBusy(false)
      }
    }, 260)
    return () => clearTimeout(t)
  }, [query, opts, mode])

  const groups = useMemo(() => {
    const map = new Map<string, SearchResult['matches']>()
    for (const m of result?.matches ?? []) {
      const list = map.get(m.path) ?? []
      list.push(m)
      map.set(m.path, list)
    }
    return [...map.entries()]
  }, [result])

  const flag = (key: keyof typeof opts, label: string, icon: ReactNode) => (
    <IconButton label={label} active={opts[key]} onClick={() => setOpts({ ...opts, [key]: !opts[key] })} className="sm">
      {icon}
    </IconButton>
  )

  return (
    <div className="search">
      <div className={cx('search-box', mode === 'meaning' && 'is-meaning')}>
        <input
          ref={inputRef}
          className="field"
          placeholder={mode === 'meaning' ? 'Describe what you are looking for' : 'Search the project'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {mode === 'exact' && (
          <div className="search-flags">
            {flag('caseSensitive', 'Match case', <CaseSensitive size={15} strokeWidth={1.7} />)}
            {flag('wholeWord', 'Whole word', <WholeWord size={15} strokeWidth={1.7} />)}
            {flag('regex', 'Regular expression', <Regex size={14} strokeWidth={1.7} />)}
          </div>
        )}
      </div>
      <div className="search-mode">
        <Segmented
          size="sm"
          value={mode}
          onChange={(v) => {
            useUi.setState({ searchMode: v })
            inputRef.current?.focus()
          }}
          options={[
            { value: 'exact', label: 'Exact', title: 'Find the exact words' },
            { value: 'meaning', label: 'Meaning', title: 'Find code by what it does, with a local embedding model' }
          ]}
        />
      </div>
      {mode === 'meaning' ? (
        <MeaningSearch query={query} />
      ) : (
      <>
      <div className="search-summary">
        {busy && <Spinner size={10} />}
        {result?.error && <span className="error-text">{result.error}</span>}
        {result && !result.error && (
          <span>
            {result.matches.length === 0
              ? 'No results'
              : `${result.matches.length}${result.truncated ? '+' : ''} results in ${groups.length} ${groups.length === 1 ? 'file' : 'files'}`}
          </span>
        )}
      </div>
      <div className="search-results">
        {groups.map(([path, matches]) => (
          <div key={path} className="search-group">
            <button className="search-file" onClick={() => setCollapsed({ ...collapsed, [path]: !collapsed[path] })}>
              <span className={cx('tree-chevron', !collapsed[path] && 'is-open')}>
                <ChevronRight size={12} strokeWidth={2} />
              </span>
              <FileIcon path={path} size={14} />
              <span className="search-file-name">{basename(path)}</span>
              <span className="search-file-dir">{dirname(path)}</span>
              <span className="count">{matches.length}</span>
            </button>
            {!collapsed[path] &&
              matches.map((m) => {
                const lead = m.text.length - m.text.trimStart().length
                const start = Math.max(0, m.column - 1 - lead)
                const t = m.text.trimStart()
                const pre = t.slice(Math.max(0, start - 30), start)
                return (
                  <button
                    key={`${m.line}:${m.column}`}
                    className="search-hit"
                    onClick={() => void openFile(path, { preview: true, line: m.line, column: m.column })}
                    onDoubleClick={() => void openFile(path, { preview: false, line: m.line, column: m.column })}
                  >
                    <span className="search-line">{m.line}</span>
                    <span className="search-text">
                      {start > 30 && '…'}
                      {pre}
                      <mark>{t.slice(start, start + m.length)}</mark>
                      {t.slice(start + m.length, start + m.length + 120)}
                    </span>
                  </button>
                )
              })}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  )
}
