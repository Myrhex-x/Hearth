import { useEffect, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { api, isMac, isWin } from '../api'
import { registerAutocomplete } from '../editor/autocomplete'
import { attachGitGutter } from '../editor/gitGutter'
import { formatBytes } from '../lib/format'
import { monaco, themeName } from '../lib/monaco'
import { basename, dirname } from '../lib/paths'
import { diffModelsFor, editorHost, getEntry, revealPending, useEditor, viewStateFor, type Tab } from '../state/editor'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { FileIcon, Kbd, Logo, cx } from './ui'

let autocompleteRegistered = false

function editorOptions(s: ReturnType<typeof useSettings.getState>['settings']): monaco.editor.IEditorOptions {
  return {
    fontSize: s.editor.fontSize,
    wordWrap: s.editor.wordWrap ? 'on' : 'off',
    minimap: { enabled: s.editor.minimap, renderCharacters: false, scale: 1, showSlider: 'mouseover' },
    lineNumbers: s.editor.lineNumbers ? 'on' : 'off'
  }
}

async function tabMenu(tab: Tab): Promise<void> {
  const { tabs, closeTab } = useEditor.getState()
  const choice = await api.app.contextMenu([
    { id: 'close', label: 'Close' },
    { id: 'others', label: 'Close Others', enabled: tabs.length > 1 },
    { id: 'right', label: 'Close Tabs to the Right' },
    { type: 'separator' },
    { id: 'copy', label: 'Copy Relative Path' },
    { id: 'reveal', label: isMac ? 'Reveal in Finder' : isWin ? 'Show in File Explorer' : 'Show in Files' }
  ])
  if (choice === 'close') void closeTab(tab.id)
  if (choice === 'others') for (const t of tabs) if (t.id !== tab.id) await closeTab(t.id)
  if (choice === 'right') {
    const i = tabs.findIndex((t) => t.id === tab.id)
    for (const t of tabs.slice(i + 1)) await closeTab(t.id)
  }
  if (choice === 'copy') void navigator.clipboard.writeText(tab.path)
  if (choice === 'reveal') api.app.revealPath(tab.path)
}

function TabStrip() {
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const { setActive, closeTab, pin } = useEditor.getState()
  const stripRef = useRef<HTMLDivElement>(null)

  const names = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tabs) counts.set(t.title, (counts.get(t.title) ?? 0) + 1)
    return counts
  }, [tabs])

  useEffect(() => {
    stripRef.current?.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  if (!tabs.length) return null
  return (
    <div className="tabstrip" ref={stripRef} onWheel={(e) => {
      if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) stripRef.current.scrollLeft += e.deltaY
    }}>
      {tabs.map((t) => (
        <div
          key={t.id}
          className={cx('tab', t.id === activeId && 'is-active', t.preview && 'is-preview', t.dirty && 'is-dirty')}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              void closeTab(t.id)
            } else if (e.button === 0) setActive(t.id)
          }}
          onDoubleClick={() => pin(t.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            void tabMenu(t)
          }}
          title={t.kind === 'diff' ? `${t.path} (${t.diffLabel})` : t.path}
        >
          <FileIcon path={t.path} size={14} />
          <span className="tab-title">
            {t.title}
            {t.kind === 'diff' && <span className="tab-tag">changes</span>}
            {(names.get(t.title) ?? 0) > 1 && <span className="tab-dir">{basename(dirname(t.path)) || '/'}</span>}
          </span>
          <button
            className="tab-close"
            aria-label="Close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(t.id)
            }}
          >
            <span className="tab-dot" />
            <X size={12} strokeWidth={2.2} className="tab-x" />
          </button>
        </div>
      ))}
    </div>
  )
}

function CodeHost({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeId = useEditor((s) => s.activeId)
  const tabs = useEditor((s) => s.tabs)
  const settings = useSettings((s) => s.settings)
  const dark = useUi((s) => s.dark)
  const tab = tabs.find((t) => t.id === activeId)

  useEffect(() => {
    if (!hostRef.current) return
    const ed = monaco.editor.create(hostRef.current, {
      model: null,
      theme: themeName(useUi.getState().dark),
      automaticLayout: true,
      fontFamily: "'SF Mono', 'JetBrains Mono Variable', Menlo, 'Cascadia Mono', Consolas, monospace",
      fontLigatures: false,
      lineHeight: 1.55,
      letterSpacing: 0,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      cursorWidth: 2,
      renderLineHighlight: 'all',
      roundedSelection: true,
      bracketPairColorization: { enabled: false },
      guides: { indentation: true, bracketPairs: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      inlineSuggest: { enabled: true, mode: 'subwordSmart' },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { showStatusBar: false, preview: false },
      stickyScroll: { enabled: true },
      fixedOverflowWidgets: true,
      contextmenu: true,
      tabSize: useSettings.getState().settings.editor.tabSize,
      detectIndentation: true,
      lineDecorationsWidth: 14,
      ...editorOptions(useSettings.getState().settings)
    })
    editorHost.editor = ed
    const gutter = attachGitGutter(ed)
    if (!autocompleteRegistered) {
      autocompleteRegistered = true
      registerAutocomplete()
    }
    const sub = ed.onDidChangeCursorSelection((e) => {
      const sel = e.selection
      const model = ed.getModel()
      useUi.setState({
        cursor: {
          line: sel.positionLineNumber,
          column: sel.positionColumn,
          selected: model && !sel.isEmpty() ? model.getValueLengthInRange(sel) : 0
        }
      })
    })
    return () => {
      sub.dispose()
      gutter.dispose()
      ed.dispose()
      editorHost.editor = null
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(themeName(dark))
  }, [dark])

  useEffect(() => {
    editorHost.editor?.updateOptions(editorOptions(settings))
  }, [settings.editor])

  const tabSize = settings.editor.tabSize
  const firstTabSize = useRef(tabSize)
  useEffect(() => {
    if (tabSize === firstTabSize.current) return
    firstTabSize.current = tabSize
    for (const m of monaco.editor.getModels()) m.updateOptions({ tabSize, indentSize: tabSize })
  }, [tabSize])

  useEffect(() => {
    const ed = editorHost.editor
    if (!ed) return
    if (!tab || tab.kind !== 'file') {
      if (ed.getModel()) ed.setModel(null)
      return
    }
    const entry = getEntry(tab.path)
    if (!entry || ed.getModel() === entry.model) return
    ed.setModel(entry.model)
    const vs = viewStateFor(tab.path)
    if (vs) ed.restoreViewState(vs)
    ed.focus()
    const pos = ed.getPosition()
    useUi.setState({ cursor: pos ? { line: pos.lineNumber, column: pos.column, selected: 0 } : null })
    // Last, so the status bar hears about the selection.
    revealPending(tab.path)
  }, [tab?.id, tab?.kind])

  return <div className={cx('code-host', !visible && 'is-hidden')} ref={hostRef} />
}

function DiffHost({ tab }: { tab: Tab }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const dark = useUi((s) => s.dark)
  const fontSize = useSettings((s) => s.settings.editor.fontSize)

  useEffect(() => {
    if (!hostRef.current) return
    const diff = monaco.editor.createDiffEditor(hostRef.current, {
      theme: themeName(useUi.getState().dark),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 860,
      fontFamily: "'SF Mono', 'JetBrains Mono Variable', Menlo, 'Cascadia Mono', Consolas, monospace",
      fontSize,
      lineHeight: 1.55,
      padding: { top: 14 },
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false }
    })
    editorHost.diff = diff
    return () => {
      diff.setModel(null)
      diff.dispose()
      editorHost.diff = null
    }
  }, [])

  useEffect(() => {
    const models = diffModelsFor(tab.id)
    if (models && editorHost.diff) editorHost.diff.setModel(models)
  }, [tab.id])

  useEffect(() => {
    monaco.editor.setTheme(themeName(dark))
  }, [dark])

  return (
    <div className="diff-wrap">
      <div className="diff-banner">
        <span>{tab.diffLabel}</span>
        <span className="diff-legend">
          <span className="legend-removed">Before</span>
          <span className="legend-added">Now</span>
        </span>
      </div>
      <div className="diff-host" ref={hostRef} />
    </div>
  )
}

function EmptyEditor() {
  const rows: [string, string][] = [
    ['Go to a file', 'mod+p'],
    ['Ask about the code', 'mod+l'],
    ['Edit the selection with the model', 'mod+k'],
    ['Show every command', 'mod+shift+p'],
    ['Open the terminal', 'ctrl+`']
  ]
  return (
    <div className="editor-empty">
      <div className="editor-empty-mark">
        <Logo size={56} />
      </div>
      <div className="editor-empty-list">
        {rows.map(([label, combo]) => (
          <div key={combo} className="editor-empty-row">
            <span>{label}</span>
            <Kbd combo={combo} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function EditorArea() {
  const tabs = useEditor((s) => s.tabs)
  const activeId = useEditor((s) => s.activeId)
  const tab = tabs.find((t) => t.id === activeId)

  return (
    <section className="editor-card">
      <TabStrip />
      <div className="editor-body">
        <CodeHost visible={tab?.kind === 'file'} />
        {tab?.kind === 'diff' && <DiffHost key={tab.id} tab={tab} />}
        {tab?.kind === 'image' && (
          <div className="image-view">
            <div className="image-frame">
              <img src={tab.imageUrl} alt={tab.title} />
            </div>
            <div className="image-meta">
              {tab.title} · {formatBytes(tab.size)}
            </div>
          </div>
        )}
        {(tab?.kind === 'binary' || tab?.kind === 'large') && (
          <div className="editor-note">
            <FileIcon path={tab.path} size={28} />
            <div className="editor-note-title">{tab.title}</div>
            <div className="editor-note-text">
              {tab.kind === 'binary' ? 'This is a binary file, so it is not shown as text.' : `This file is ${formatBytes(tab.size)}, too large to open here.`}
            </div>
          </div>
        )}
        {!tab && <EmptyEditor />}
      </div>
    </section>
  )
}
