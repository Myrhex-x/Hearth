import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, RotateCw } from 'lucide-react'
import type { MeaningResult } from '../../../shared/types'
import { STANDS_OUT, previewLine } from '../../../shared/semantic'
import { basename, dirname } from '../lib/paths'
import { useEditor } from '../state/editor'
import { useMeaning } from '../state/meaning'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { Button, FileIcon, Spinner, cx } from './ui'

const SUGGESTED = { name: 'qwen3-embedding:0.6b', size: 'about 640 MB' }

function IndexState() {
  const status = useMeaning((s) => s.status)
  const indexing = useSettings((s) => s.settings.indexing)
  const update = useSettings((s) => s.update)
  const { statuses, pulls, pull } = useModels()
  const ollama = statuses.find((s) => s.kind === 'ollama' && s.ok)

  if (!indexing) {
    return (
      <div className="meaning-state">
        <p>Search by meaning is turned off.</p>
        <Button size="sm" variant="tinted" onClick={() => void update({ indexing: true })}>
          Turn it on
        </Button>
      </div>
    )
  }
  if (status.state === 'no-model' || status.state === 'off') {
    const pulling = pulls[SUGGESTED.name]
    return (
      <div className="meaning-state">
        <p>Find code by what it does, like “where are passwords checked”. This needs a small embedding model that runs on your computer.</p>
        {ollama ? (
          pulling ? (
            <span className="meaning-progress-text">
              <Spinner size={10} /> Downloading {SUGGESTED.name} {pulling.total ? `${Math.round(((pulling.completed ?? 0) / pulling.total) * 100)}%` : ''}
            </span>
          ) : (
            <Button size="sm" variant="tinted" icon={<ArrowDownToLine size={12} />} onClick={() => pull(ollama.id, SUGGESTED.name)}>
              Get {SUGGESTED.name} · {SUGGESTED.size}
            </Button>
          )
        ) : (
          <Button size="sm" onClick={() => useUi.getState().openSettings('search')}>
            Choose a model
          </Button>
        )}
      </div>
    )
  }
  if (status.state === 'error') {
    return (
      <div className="meaning-state">
        <p className="error-text">{status.error ?? 'The index could not be built.'}</p>
        <Button size="sm" icon={<RotateCw size={12} />} onClick={() => void useMeaning.getState().rebuild()}>
          Try again
        </Button>
      </div>
    )
  }
  if (status.state === 'indexing') {
    const pct = status.total ? Math.round((status.done / status.total) * 100) : 0
    return (
      <div className="meaning-indexing">
        <div className="row between">
          <span>{status.total ? `Indexing ${status.done.toLocaleString()} of ${status.total.toLocaleString()} files` : 'Looking for changes'}</span>
          <Spinner size={10} />
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      </div>
    )
  }
  return null
}

function Result({ r, best, query }: { r: MeaningResult; best: number; query: string }) {
  const openFile = useEditor((s) => s.openFile)
  const lines = r.text.split('\n')
  const offset = useMemo(() => previewLine(r.text, query), [r.text, query])
  const from = r.start + offset
  const shown = lines.slice(offset, offset + 6)
  // Remove the indentation the shown lines share, so the code starts at the left edge.
  const indent = Math.min(...shown.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length))
  const preview = shown.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
  // Above the baseline and relative to the best hit: raw scores differ from one embedding model to the next.
  const strength = best > 0 ? Math.max(0.15, Math.min(1, r.standout / best)) : 0.15
  return (
    <button
      className="meaning-hit"
      onClick={() => void openFile(r.path, { preview: true, line: from, endLine: r.end })}
      onDoubleClick={() => void openFile(r.path, { preview: false, line: from, endLine: r.end })}
      title={`${r.path}, lines ${from} to ${r.end}`}
    >
      <span className="meaning-hit-head">
        <FileIcon path={r.path} size={14} />
        <span className="search-file-name">{basename(r.path)}</span>
        <span className="search-file-dir">{dirname(r.path)}</span>
        <span className="meaning-strength" title="How closely this matches, compared with the best result">
          <span style={{ width: `${Math.round(strength * 100)}%` }} />
        </span>
        <span className="meaning-lines">
          {from}-{r.end}
        </span>
      </span>
      <code className="meaning-preview">{preview.join('\n')}</code>
    </button>
  )
}

export function MeaningSearch({ query }: { query: string }) {
  const status = useMeaning((s) => s.status)
  const [results, setResults] = useState<MeaningResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const searchable = (status.state === 'ready' || status.state === 'indexing') && status.chunks > 0

  useEffect(() => {
    if (!query.trim() || !searchable) {
      setResults(null)
      return
    }
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      setError(null)
      try {
        const res = await useMeaning.getState().search(query, 12)
        if (id === seq.current) setResults(res)
      } catch (err) {
        if (id === seq.current) setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      } finally {
        if (id === seq.current) setBusy(false)
      }
    }, 450)
    return () => clearTimeout(t)
    // Re-run when the index grows from empty to searchable.
  }, [query, searchable])

  const best = results?.[0]?.standout ?? 0
  const weak = !!results?.length && best < STANDS_OUT
  return (
    <>
      <IndexState />
      <div className="search-summary">
        {busy && <Spinner size={10} />}
        {error && <span className="error-text">{error}</span>}
        {!error && results && (
          <span>{!results.length ? 'Nothing related found' : weak ? 'Nothing clearly matches. These are the closest' : `${results.length} places that look related`}</span>
        )}
        {!results && !busy && searchable && status.state === 'ready' && (
          <span className={cx('meaning-ready')}>
            {status.files.toLocaleString()} files indexed with {status.model?.split('::')[1]}
          </span>
        )}
      </div>
      <div className="search-results">
        {results?.map((r) => <Result key={`${r.path}:${r.start}`} r={r} best={best} query={query} />)}
      </div>
    </>
  )
}
