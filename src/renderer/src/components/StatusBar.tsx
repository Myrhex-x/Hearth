import { CircleAlert, GitBranch, ScanSearch, Sparkles } from 'lucide-react'
import { splitModelId } from '../../../shared/types'
import { shortModelName } from '../lib/format'
import { languageLabel } from '../lib/monaco'
import { activeTab, editorHost, useEditor } from '../state/editor'
import { useModels } from '../state/models'
import { useMeaning } from '../state/meaning'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { useWorkspace } from '../state/workspace'
import { Spinner, cx } from './ui'

export function StatusBar() {
  const branch = useWorkspace((s) => s.branch)
  const cursor = useUi((s) => s.cursor)
  useEditor((s) => s.activeId)
  const tab = activeTab()
  const settings = useSettings((s) => s.settings)
  const busy = useModels((s) => s.autocompleteBusy)
  const error = useModels((s) => s.autocompleteError)
  const model = editorHost.editor?.getModel()
  const showEditorInfo = tab?.kind === 'file' && model

  const ac = settings.autocompleteModel ? shortModelName(splitModelId(settings.autocompleteModel).name) : null
  const index = useMeaning((s) => s.status)
  const openMeaning = () => {
    if (!settings.layout.sidebarVisible) void useSettings.getState().update({ layout: { sidebarVisible: true } })
    useUi.setState({ sidebarTab: 'search', searchMode: 'meaning' })
    useUi.getState().focusSearch()
  }

  return (
    <footer className="statusbar">
      <div className="status-left">
        {branch && (
          <span className="status-item">
            <GitBranch size={12} strokeWidth={1.8} />
            {branch}
          </span>
        )}
      </div>
      <div className="status-right">
        {index.state === 'indexing' && (
          <button className="status-item status-button" title="Building the index for search by meaning" onClick={openMeaning}>
            <Spinner size={9} />
            {index.total ? `Indexing ${Math.round((index.done / index.total) * 100)}%` : 'Indexing'}
          </button>
        )}
        {index.state === 'ready' && (
          <button className="status-item status-button is-quiet" title={`Search by meaning: ${index.files.toLocaleString()} files, ${index.chunks.toLocaleString()} pieces`} onClick={openMeaning}>
            <ScanSearch size={12} strokeWidth={1.8} />
            Indexed
          </button>
        )}
        {index.state === 'error' && (
          <button className="status-item status-button tone-rose" title={index.error} onClick={openMeaning}>
            <CircleAlert size={12} />
            Index
          </button>
        )}
        {showEditorInfo && cursor && (
          <span className="status-item">
            Ln {cursor.line}, Col {cursor.column}
            {cursor.selected ? ` (${cursor.selected} selected)` : ''}
          </span>
        )}
        {showEditorInfo && <span className="status-item">{model.getOptions().insertSpaces ? `Spaces: ${model.getOptions().tabSize}` : `Tab size: ${model.getOptions().tabSize}`}</span>}
        {showEditorInfo && <span className="status-item">{model.getEOL() === '\r\n' ? 'CRLF' : 'LF'}</span>}
        {showEditorInfo && <span className="status-item">{languageLabel(model.getLanguageId())}</span>}
        <button
          className={cx('status-item status-button', error && 'tone-rose', !settings.autocompleteEnabled && 'is-off')}
          title={error ?? (settings.autocompleteEnabled ? `Autocomplete with ${ac ?? 'no model'}. Click to change.` : 'Autocomplete is off. Click to change.')}
          onClick={() => useUi.getState().setModelsOpen(true)}
        >
          {busy ? <Spinner size={9} /> : error ? <CircleAlert size={12} /> : <Sparkles size={12} strokeWidth={1.8} />}
          {settings.autocompleteEnabled ? (ac ?? 'No autocomplete model') : 'Autocomplete off'}
        </button>
      </div>
    </footer>
  )
}
