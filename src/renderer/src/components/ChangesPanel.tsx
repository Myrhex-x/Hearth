import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, ExternalLink, FileText, GitBranch, Minus, MoreHorizontal, Plus, RotateCw, Square, Undo2 } from 'lucide-react'
import type { GitFileStatus } from '../../../shared/types'
import { api, isMac, isStore } from '../api'
import { shortcutLabel } from '../lib/keys'
import { basename, dirname } from '../lib/paths'
import { useEditor } from '../state/editor'
import { gitLetter, useGit } from '../state/git'
import { useUi } from '../state/ui'
import { Ember, FileIcon, IconButton, Spinner, cx } from './ui'

/** Opens the change as a diff against the last commit. */
async function openChange(f: GitFileStatus): Promise<void> {
  const base = f.kind === 'untracked' || f.kind === 'added' ? '' : ((await api.git.showHead(f.origPath ?? f.path).catch(() => null)) ?? '')
  const label = f.kind === 'deleted' ? 'Deleted since the last commit' : f.kind === 'untracked' || f.kind === 'added' ? 'New file' : 'Changes since the last commit'
  await useEditor.getState().openDiff(f.path, base, label)
}

function Row({ f, staged }: { f: GitFileStatus; staged: boolean }) {
  const { stage, unstage, discard } = useGit.getState()
  const openFile = useEditor((s) => s.openFile)
  const dir = dirname(f.path)
  return (
    <div className={cx('scm-row', `is-${f.kind}`)} onClick={() => void openChange(f)} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
      <FileIcon path={f.path} size={14} />
      <span className="scm-name">{basename(f.path)}</span>
      <span className="scm-dir">{dir}</span>
      <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
        {f.kind !== 'deleted' && (
          <IconButton label="Open file" className="sm" onClick={() => void openFile(f.path, { preview: false })}>
            <FileText size={13} strokeWidth={1.8} />
          </IconButton>
        )}
        {!staged && (
          <IconButton label="Discard changes" className="sm" onClick={() => void discard([f])}>
            <Undo2 size={13} strokeWidth={1.8} />
          </IconButton>
        )}
        {staged ? (
          <IconButton label="Unstage" className="sm" onClick={() => void unstage([f.path])}>
            <Minus size={14} strokeWidth={2} />
          </IconButton>
        ) : (
          <IconButton label="Stage" className="sm" onClick={() => void stage([f.path])}>
            <Plus size={14} strokeWidth={2} />
          </IconButton>
        )}
      </span>
      <span className="scm-letter">{gitLetter(f)}</span>
    </div>
  )
}

function Section({ title, files, staged }: { title: string; files: GitFileStatus[]; staged: boolean }) {
  const [open, setOpen] = useState(true)
  const { stage, unstage } = useGit.getState()
  if (!files.length) return null
  return (
    <div className="scm-section">
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className={cx('tree-chevron', open && 'is-open')}>
          <ChevronRight size={12} strokeWidth={2} />
        </span>
        <span className="scm-section-title">{title}</span>
        <span className="count">{files.length}</span>
        <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
          {staged ? (
            <IconButton label="Unstage all" className="sm" onClick={() => void unstage(files.map((f) => f.path))}>
              <Minus size={14} strokeWidth={2} />
            </IconButton>
          ) : (
            <IconButton label="Stage all" className="sm" onClick={() => void stage(files.map((f) => f.path))}>
              <Plus size={14} strokeWidth={2} />
            </IconButton>
          )}
        </span>
      </div>
      {open && files.map((f) => <Row key={`${staged}:${f.path}`} f={f} staged={staged} />)}
    </div>
  )
}

async function moreMenu(): Promise<void> {
  const { status, pull, push, fetch } = useGit.getState()
  const remote = !!status?.hasRemote
  const choice = await api.app.contextMenu([
    { id: 'pull', label: 'Pull', enabled: remote && !!status?.upstream },
    { id: 'push', label: status?.upstream ? 'Push' : 'Publish Branch', enabled: remote },
    { id: 'fetch', label: 'Fetch', enabled: remote }
  ])
  if (choice === 'pull') void pull()
  if (choice === 'push') void push()
  if (choice === 'fetch') void fetch()
}

function CommitBox() {
  const message = useGit((s) => s.message)
  const writing = useGit((s) => s.writing)
  const busy = useGit((s) => s.busy)
  const status = useGit((s) => s.status)
  const { setMessage, commit, writeMessage, stopWriting } = useGit.getState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const staged = status?.files.some((f) => f.staged) ?? false
  const any = (status?.files.length ?? 0) > 0
  const wasWriting = useRef(false)

  useEffect(() => {
    if (wasWriting.current && !writing) ref.current?.focus()
    wasWriting.current = writing
  }, [writing])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(180, Math.max(56, el.scrollHeight))}px`
  }, [message])

  return (
    <div className="scm-commit">
      <div className={cx('scm-message', writing && 'is-writing')}>
        <textarea
          ref={ref}
          value={message}
          placeholder={`Message (${shortcutLabel('mod+enter')} to commit)`}
          spellCheck
          readOnly={writing}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <button
          className="scm-write"
          title={writing ? 'Stop' : 'Write the message with your local model'}
          disabled={!any && !writing}
          onClick={() => (writing ? stopWriting() : void writeMessage())}
        >
          {writing ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <Ember state="warm" size={14} />}
          <span>{writing ? 'Writing' : 'Write message'}</span>
        </button>
      </div>
      <button className="btn btn-filled scm-commit-btn" disabled={!any || writing || busy !== null} onClick={() => void commit()}>
        {busy === 'commit' ? <Spinner size={11} /> : null}
        <span>{staged ? 'Commit' : 'Commit all'}</span>
      </button>
    </div>
  )
}

export function ChangesPanel() {
  const status = useGit((s) => s.status)
  const busy = useGit((s) => s.busy)
  const { refresh, init, push, pull } = useGit.getState()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!status) {
    return (
      <div className="scm-empty">
        <Spinner size={12} />
      </div>
    )
  }
  if (!status.available) {
    return (
      <div className="scm-empty">
        <p>
          {isStore
            ? "Source control uses Apple's command line developer tools. Install them by running xcode-select --install in Terminal, then reopen the folder."
            : 'Install Git to see, review and commit your changes here.'}
        </p>
        {!isStore && (
          <button className="btn btn-plain btn-sm" onClick={() => api.app.openExternal('https://git-scm.com/downloads')}>
            <ExternalLink size={12} />
            <span>Get Git</span>
          </button>
        )}
      </div>
    )
  }
  if (!status.isRepo) {
    return (
      <div className="scm-empty">
        <p>This folder is not a Git repository yet. Create one to track your changes and undo anything later.</p>
        <button className="btn btn-tinted btn-sm" disabled={busy === 'init'} onClick={() => void init()}>
          {busy === 'init' ? <Spinner size={11} /> : <GitBranch size={12} />}
          <span>Create repository</span>
        </button>
      </div>
    )
  }

  const staged = status.files.filter((f) => f.staged)
  const unstaged = status.files.filter((f) => f.unstaged)

  return (
    <div className="scm">
      <div className="scm-branch">
        <GitBranch size={13} strokeWidth={1.8} />
        <span className="scm-branch-name">{status.branch ?? 'detached HEAD'}</span>
        {status.behind > 0 && (
          <button className="scm-sync" title="Pull" onClick={() => void pull()} disabled={busy !== null}>
            <ArrowDown size={11} strokeWidth={2.2} />
            {status.behind}
          </button>
        )}
        {status.hasRemote && (status.ahead > 0 || (!status.upstream && status.branch)) && (
          <button className="scm-sync" title={status.upstream ? 'Push' : 'Publish branch'} onClick={() => void push()} disabled={busy !== null}>
            <ArrowUp size={11} strokeWidth={2.2} />
            {status.upstream ? status.ahead : 'Publish'}
          </button>
        )}
        <span className="spacer" />
        {busy && busy !== 'commit' && <Spinner size={11} />}
        <IconButton
          label="Refresh"
          className="sm"
          onClick={async () => {
            setRefreshing(true)
            await refresh()
            setRefreshing(false)
          }}
        >
          {refreshing ? <Spinner size={10} /> : <RotateCw size={12} strokeWidth={1.9} />}
        </IconButton>
        <IconButton label="More" className="sm" onClick={() => void moreMenu()}>
          <MoreHorizontal size={14} strokeWidth={1.9} />
        </IconButton>
      </div>
      <CommitBox />
      {status.error && <div className="scm-error">{status.error}</div>}
      <div className="scm-list">
        <Section title="Staged" files={staged} staged />
        <Section title={staged.length ? 'Not staged' : 'Changes'} files={unstaged} staged={false} />
        {!status.files.length && <div className="scm-clean">No changes. Everything is committed.</div>}
      </div>
    </div>
  )
}

export function useGitBadge(): number {
  return useGit((s) => s.status?.files.length ?? 0)
}

export function focusChanges(): void {
  useUi.setState({ sidebarTab: 'changes' })
}
