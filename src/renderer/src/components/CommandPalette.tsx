import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { COMMANDS, runCommand } from '../lib/commands'
import { fuzzyFilter } from '../lib/fuzzy'
import { basename, dirname } from '../lib/paths'
import { recentFiles } from '../lib/recent'
import { useEditor } from '../state/editor'
import { useUi } from '../state/ui'
import { useWorkspace } from '../state/workspace'
import { FileIcon, Highlighted, Kbd, Spinner, cx } from './ui'

export function CommandPalette() {
  const palette = useUi((s) => s.palette)
  const close = useUi((s) => s.closePalette)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [pendingEnter, setPendingEnter] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const files = useWorkspace((s) => s.files)
  const ensureFiles = useWorkspace((s) => s.ensureFiles)
  const hasFolder = useWorkspace((s) => !!s.info)

  // Focus synchronously: animation frames are throttled in background windows,
  // and keystrokes typed right after the shortcut must land in the field.
  useLayoutEffect(() => {
    if (!palette) return
    setQuery(palette.mode === 'commands' ? '>' + palette.query : palette.query)
    setIndex(0)
    setPendingEnter(false)
    inputRef.current?.focus()
    if (palette.mode === 'files') void ensureFiles()
  }, [palette, ensureFiles])

  const isCommands = query.startsWith('>')
  const term = isCommands ? query.slice(1).trim() : query.trim()

  const commandResults = useMemo(() => {
    if (!isCommands) return []
    const available = COMMANDS.filter((c) => !c.needsFolder || hasFolder)
    return fuzzyFilter(available, term, (c) => c.title, 50)
  }, [isCommands, term, hasFolder])

  const fileResults = useMemo(() => {
    if (isCommands) return []
    const all = files ?? []
    if (!term) {
      const recent = recentFiles().filter((f) => all.includes(f))
      const rest = all.filter((f) => !recent.includes(f))
      return [...recent, ...rest].slice(0, 50).map((item) => ({ item, positions: [] as number[] }))
    }
    return fuzzyFilter(all, term, (f) => f, 50)
  }, [isCommands, term, files])

  const count = isCommands ? commandResults.length : fileResults.length

  useEffect(() => {
    listRef.current?.querySelector('.palette-row.is-on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  // Enter pressed while the file index was still loading: open the best match once it arrives.
  useEffect(() => {
    if (pendingEnter && files) {
      setPendingEnter(false)
      if (fileResults.length) {
        useUi.getState().closePalette()
        void useEditor.getState().openFile(fileResults[0].item, { preview: false })
      }
    }
  }, [pendingEnter, files, fileResults])

  if (!palette) return null

  const choose = (i: number) => {
    if (isCommands) {
      const c = commandResults[i]
      if (!c) return
      close()
      runCommand(c.item.id)
    } else {
      const f = fileResults[i]
      if (!f) return
      close()
      void useEditor.getState().openFile(f.item, { preview: false })
    }
  }

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          {isCommands ? <ChevronRight size={16} strokeWidth={2} className="tone-ember" /> : <Search size={15} strokeWidth={2} />}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            spellCheck={false}
            placeholder={isCommands ? 'Type a command' : 'Search files by name. Type > for commands'}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(count - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (!isCommands && !files) setPendingEnter(true)
                else choose(index)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {!isCommands && !files && (
            <div className="palette-empty">
              <Spinner size={11} /> Indexing files
            </div>
          )}
          {isCommands &&
            commandResults.map((r, i) => (
              <button key={r.item.id} className={cx('palette-row', i === index && 'is-on')} onMouseMove={() => setIndex(i)} onClick={() => choose(i)}>
                <span className="palette-title">
                  <Highlighted text={r.item.title} positions={r.positions} />
                </span>
                {r.item.shortcut && <Kbd combo={r.item.shortcut} />}
              </button>
            ))}
          {!isCommands &&
            fileResults.map((r, i) => {
              const name = basename(r.item)
              const offset = r.item.length - name.length
              return (
                <button key={r.item} className={cx('palette-row', i === index && 'is-on')} onMouseMove={() => setIndex(i)} onClick={() => choose(i)}>
                  <FileIcon path={r.item} size={14} />
                  <span className="palette-title">
                    <Highlighted text={name} positions={r.positions.filter((p) => p >= offset).map((p) => p - offset)} />
                  </span>
                  <span className="palette-sub">
                    <Highlighted text={dirname(r.item)} positions={r.positions.filter((p) => p < offset - 1)} />
                  </span>
                </button>
              )
            })}
          {count === 0 && (isCommands || files) && <div className="palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  )
}
