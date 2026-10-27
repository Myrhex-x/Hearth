import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  ScanSearch,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileSearch,
  FolderTree,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Square,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import { splitModelId } from '../../../shared/types'
import { isMac } from '../api'
import { computeDiff } from '../agent/diff'
import type { AssistantPart, ChatMessage, ContextChip, DiffInfo, FileChange, ToolStep } from '../agent/types'
import { imageData, isImageFile } from '../lib/images'
import { fuzzyFilter } from '../lib/fuzzy'
import { formatDuration, relativeTime, shortModelName } from '../lib/format'
import { shortcutLabel } from '../lib/keys'
import { basename, dirname } from '../lib/paths'
import { useChat, type ChatMode } from '../state/chat'
import { activeTab, useEditor } from '../state/editor'
import { chatModels, supportsTools, supportsVision, useModels } from '../state/models'
import { useSettings } from '../state/settings'
import { toast, useUi } from '../state/ui'
import { useWorkspace } from '../state/workspace'
import { useEmber } from './Hearth'
import { Markdown } from './Markdown'
import { Ember, FileIcon, Highlighted, IconButton, Popover, Segmented, Spinner, cx } from './ui'

export function ChatPanel() {
  const threads = useChat((s) => s.threads)
  const activeId = useChat((s) => s.activeId)
  const thread = threads.find((t) => t.id === activeId)
  const historyRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <section className="chat-card">
      <div className="chat-head">
        <div className="chat-title" title={thread?.title}>
          {thread?.messages.length ? thread.title : 'New chat'}
        </div>
        <IconButton label="Chat history" ref={historyRef} onClick={() => setHistoryOpen(!historyOpen)} active={historyOpen}>
          <Clock3 size={15} strokeWidth={1.7} />
        </IconButton>
        <IconButton label="New chat" shortcut="mod+shift+l" onClick={() => useChat.getState().newThread()}>
          <Plus size={16} strokeWidth={1.8} />
        </IconButton>
        <Popover anchor={historyRef.current} open={historyOpen} onClose={() => setHistoryOpen(false)} align="end" width={300}>
          <ThreadList onPick={() => setHistoryOpen(false)} />
        </Popover>
      </div>
      <Messages />
      <Composer />
    </section>
  )
}

function ThreadList({ onPick }: { onPick: () => void }) {
  const threads = useChat((s) => s.threads)
  const activeId = useChat((s) => s.activeId)
  const list = [...threads].filter((t) => t.messages.length).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!list.length) return <div className="menu-empty">No conversations yet.</div>
  return (
    <div className="menu-list">
      {list.map((t) => (
        <div key={t.id} className={cx('menu-row', t.id === activeId && 'is-on')} onClick={() => {
          useChat.getState().select(t.id)
          onPick()
        }}>
          <div className="menu-row-main">
            <span className="menu-row-title">{t.title}</span>
            <span className="menu-row-sub">{relativeTime(t.updatedAt)}</span>
          </div>
          <button className="icon-btn sm menu-row-x" title="Delete" onClick={(e) => {
            e.stopPropagation()
            useChat.getState().deleteThread(t.id)
          }}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function Messages() {
  const thread = useChat((s) => s.threads.find((t) => t.id === s.activeId))
  const running = useChat((s) => s.runningThread)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  useEffect(() => {
    stick.current = true
  }, [thread?.id])

  if (!thread || !thread.messages.length) return <EmptyChat />
  return (
    <div
      className="messages"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      }}
    >
      {thread.messages.map((m, i) => {
        const last = i === thread.messages.length - 1 || (i === thread.messages.length - 2 && m.role === 'user')
        const idle = running !== thread.id
        return m.role === 'user' ? (
          <UserMessage key={m.id} m={m} editable={last && idle} />
        ) : (
          <AssistantMessage key={m.id} m={m} live={running === thread.id && !m.done} retryable={last && idle} />
        )
      })}
    </div>
  )
}

function EmptyChat() {
  const info = useWorkspace((s) => s.info)
  const { state } = useEmber()
  const hasFile = useEditor((s) => s.tabs.some((t) => t.id === s.activeId && t.kind === 'file'))
  const ideas = hasFile
    ? ['Explain what this file does', 'Look for bugs in this file', 'Write tests for this file']
    : ['How is this project organized?', 'Where is the entry point?', 'Suggest a first improvement']
  return (
    <div className="chat-empty">
      <div className={cx('chat-empty-mark', `is-${state}`)}>
        <Ember state={state} size={38} />
      </div>
      <div className="chat-empty-title">{info ? `Work on ${info.name}` : 'Your local model'}</div>
      <div className="chat-empty-text">Ask a question, or describe a change and let the agent read, edit and test the code. Nothing leaves this computer.</div>
      <div className="chat-ideas">
        {ideas.map((i) => (
          <button key={i} className="idea" onClick={() => void useChat.getState().send(i)}>
            {i}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChipView({ chip, onRemove, suggested }: { chip: ContextChip; onRemove?: () => void; suggested?: boolean }) {
  const label = chip.kind === 'file' ? basename(chip.path) : `${basename(chip.path)} ${chip.startLine}-${chip.endLine}`
  const found = chip.kind === 'snippet'
  return (
    <span
      className={cx('chip', suggested && 'is-suggested', found && 'is-found')}
      title={found ? `${chip.path}, lines ${chip.startLine} to ${chip.endLine}: found by meaning and given to the model` : chip.path}
      onClick={found ? () => void useEditor.getState().openFile(chip.path, { preview: true, line: chip.startLine, endLine: chip.endLine }) : undefined}
    >
      {found ? <ScanSearch size={12} strokeWidth={1.9} className="chip-found-icon" /> : <FileIcon path={chip.path} size={12} />}
      <span className="chip-label">{label}</span>
      {onRemove && (
        <button className="chip-x" aria-label="Remove" onClick={onRemove}>
          <X size={10} strokeWidth={2.4} />
        </button>
      )}
    </span>
  )
}

const UserMessage = memo(function UserMessage({ m, editable }: { m: ChatMessage; editable: boolean }) {
  return (
    <div className="msg-user">
      {editable && (
        <button className="msg-user-edit" title="Edit and send again" onClick={() => void useChat.getState().editLast()}>
          <Pencil size={12} strokeWidth={1.9} />
        </button>
      )}
      {!!m.chips?.length && (
        <div className="msg-chips">
          {m.chips.map((c, i) => (
            <ChipView key={i} chip={c} />
          ))}
        </div>
      )}
      {!!m.images?.length && (
        <div className="msg-images">
          {m.images.map((img) => (
            <button key={img.id} className="msg-image" title={img.name} onClick={() => useUi.setState({ lightbox: { id: img.id, name: img.name } })}>
              <img src={img.thumb} alt={img.name} />
            </button>
          ))}
        </div>
      )}
      {m.text && <div className="msg-user-text">{m.text}</div>}
    </div>
  )
})

/** The full-size image, over everything. */
export function Lightbox() {
  const open = useUi((s) => s.lightbox)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!open) return
    let live = true
    void imageData(open.id).then((data) => {
      if (live && data) setSrc(`data:${open.id.endsWith('.jpg') ? 'image/jpeg' : `image/${open.id.split('.').pop()}`};base64,${data}`)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.setState({ lightbox: null })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      live = false
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="scrim is-sheet lightbox" onMouseDown={() => useUi.setState({ lightbox: null })}>
      {src ? <img src={src} alt={open.name} /> : <Spinner size={16} />}
      <div className="lightbox-name">{open.name}</div>
    </div>,
    document.body
  )
}

function Thinking({ part, live }: { part: Extract<AssistantPart, { kind: 'thinking' }>; live: boolean }) {
  const [open, setOpen] = useState(false)
  const active = live && !part.endedAt
  const secs = ((part.endedAt ?? Date.now()) - part.startedAt) / 1000
  return (
    <div className={cx('thinking', (open || active) && 'is-open')}>
      <button className="thinking-head" onClick={() => setOpen(!open)}>
        {active ? <Spinner size={10} /> : <ChevronRight size={12} strokeWidth={2} className="thinking-chev" />}
        <span>{active ? 'Thinking' : `Thought for ${formatDuration(secs * 1000)}`}</span>
      </button>
      {(open || active) && <div className="thinking-body">{part.text.trim()}</div>}
    </div>
  )
}

function DiffLines({ diff, limit }: { diff: DiffInfo; limit?: number }) {
  let shown = 0
  const max = limit ?? Infinity
  const out: ReactElement[] = []
  for (let h = 0; h < diff.hunks.length && shown < max; h++) {
    const hunk = diff.hunks[h]
    if (h > 0) out.push(<div key={`gap${h}`} className="diff-gap" />)
    let oldN = hunk.oldStart
    let newN = hunk.newStart
    for (let i = 0; i < hunk.lines.length && shown < max; i++, shown++) {
      const line = hunk.lines[i]
      const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
      const n = kind === 'del' ? oldN++ : kind === 'add' ? newN++ : (oldN++, newN++)
      out.push(
        <div key={`${h}:${i}`} className={cx('diff-line', `is-${kind}`)}>
          <span className="diff-n">{n}</span>
          <span className="diff-sign">{kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}</span>
          <span className="diff-text">{line.slice(1) || ' '}</span>
        </div>
      )
    }
  }
  return <div className="diff-lines">{out}</div>
}

function countLines(diff: DiffInfo): number {
  return diff.hunks.reduce((n, h) => n + h.lines.length, 0)
}

function Approval({ step, primary, secondary }: { step: ToolStep; primary: string; secondary: string }) {
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const decide = useChat((s) => s.decide)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        decide(step.id, { approved: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step.id, decide])
  return (
    <div className="approval">
      {asking ? (
        <form
          className="approval-note"
          onSubmit={(e) => {
            e.preventDefault()
            decide(step.id, { approved: false, feedback: note.trim() || undefined })
          }}
        >
          <input className="field" autoFocus placeholder="Tell the model what to do instead (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-plain btn-sm" type="submit">
            <span>Send</span>
          </button>
        </form>
      ) : (
        <>
          <button className="btn btn-plain btn-sm" onClick={() => setAsking(true)}>
            <span>{secondary}</span>
          </button>
          <button className="btn btn-filled btn-sm" onClick={() => decide(step.id, { approved: true })}>
            <span>{primary}</span>
            <kbd className="kbd on-filled">{shortcutLabel('mod+enter')}</kbd>
          </button>
        </>
      )}
    </div>
  )
}

function StepIcon({ step }: { step: ToolStep }) {
  const props = { size: 13, strokeWidth: 1.8 }
  if (step.status === 'running') return <Spinner size={11} />
  if (step.status === 'error') return <CircleAlert {...props} className="tone-rose" />
  switch (step.name) {
    case 'read_file':
      return <FileSearch {...props} />
    case 'list_files':
      return <FolderTree {...props} />
    case 'search':
      return <Search {...props} />
    case 'run_command':
      return <SquareTerminal {...props} />
    case 'edit_file':
    case 'write_file':
      return <Pencil {...props} />
    case 'delete_file':
      return <Trash2 {...props} />
    default:
      return <Check {...props} />
  }
}

/**
 * What a vision model wrote about an image. Not Markdown: a transcribed
 * terminal line like "> app@1.0 test" must stay as written. Fenced blocks are
 * shown in monospace.
 */
function LookText({ text }: { text: string }) {
  const parts = text.split(/^```[^\n]*\n?/m)
  return (
    <>
      {parts.map((part, i) => {
        const t = part.replace(/^\n+|\s+$/g, '')
        if (!t) return null
        return i % 2 ? (
          <pre key={i} className="look-code">
            {t}
          </pre>
        ) : (
          <p key={i}>{t}</p>
        )
      })}
    </>
  )
}

function ToolStepView({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = useState(false)
  const openFile = useEditor((s) => s.openFile)
  const isChange = step.name === 'edit_file' || step.name === 'write_file' || step.name === 'delete_file'

  if (step.name === 'describe_image') {
    const text = (step.output ?? '').trim()
    const long = text.split('\n').length > 6 || text.length > 420
    return (
      <div className={cx('step-card', 'look-card', `is-${step.status}`)}>
        <div className="step-card-head">
          {typeof step.args.thumb === 'string' && <img className="look-thumb" src={step.args.thumb} alt="" />}
          <span className="look-title">{step.title}</span>
          <span className="step-state">{step.status === 'running' ? <Spinner size={10} /> : step.detail}</span>
        </div>
        {text && (
          <div className={cx('look-text', long && !expanded && step.status !== 'running' && 'is-clipped')} onClick={() => setExpanded(true)}>
            <LookText text={text} />
          </div>
        )}
        {step.error && <div className="step-error">{step.error}</div>}
      </div>
    )
  }

  if (step.name === 'run_command') {
    const out = (step.output ?? '').trimEnd()
    const lines = out.split('\n')
    const showAll = expanded || step.status === 'running'
    return (
      <div className={cx('step-card', `is-${step.status}`)}>
        <div className="step-card-head">
          <StepIcon step={step} />
          <code className="step-command">{step.command}</code>
          {step.exitCode !== undefined && step.exitCode !== null && (
            <span className={cx('badge', step.exitCode === 0 ? 'tone-sage' : 'tone-rose')}>{step.exitCode === 0 ? 'done' : `exit ${step.exitCode}`}</span>
          )}
          {step.status === 'declined' && <span className="badge">skipped</span>}
        </div>
        {step.detail && <div className="step-sub">{step.detail}</div>}
        {out && (
          <pre className={cx('step-output', !showAll && lines.length > 8 && 'is-clipped')} onClick={() => setExpanded(true)}>
            {showAll ? out : lines.slice(-8).join('\n')}
          </pre>
        )}
        {step.status === 'awaiting' && <Approval step={step} primary="Run" secondary="Skip" />}
        {step.error && <div className="step-error">{step.error}</div>}
      </div>
    )
  }

  if (isChange && step.diff) {
    const total = countLines(step.diff)
    const limit = expanded ? undefined : 14
    return (
      <div className={cx('step-card', `is-${step.status}`)}>
        <button className="step-card-head as-button" onClick={() => step.path && step.name !== 'delete_file' && void openFile(step.path, { preview: false })}>
          <FileIcon path={step.path ?? ''} size={14} />
          <span className="step-file">{step.path}</span>
          <span className="diffstat">
            {step.diff.added > 0 && <span className="tone-sage">+{step.diff.added}</span>}
            {step.diff.removed > 0 && <span className="tone-rose">−{step.diff.removed}</span>}
          </span>
          <span className="step-state">
            {step.status === 'awaiting' ? 'waiting for you' : step.status === 'declined' ? 'declined' : step.status === 'error' ? 'failed' : step.status === 'running' ? '' : step.name === 'delete_file' ? 'deleted' : 'applied'}
          </span>
        </button>
        <DiffLines diff={step.diff} limit={limit} />
        {total > 14 && (
          <button className="step-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${total} lines`}
          </button>
        )}
        {step.status === 'awaiting' && <Approval step={step} primary={step.name === 'delete_file' ? 'Delete' : 'Apply'} secondary="Decline" />}
        {step.error && <div className="step-error">{step.error}</div>}
      </div>
    )
  }

  return (
    <div className={cx('step', `is-${step.status}`)}>
      <span className="step-icon">
        <StepIcon step={step} />
      </span>
      <span className="step-title">
        {step.path && (step.name === 'read_file' || step.name === 'edit_file') ? (
          <>
            {step.title.replace(step.path, '').trim()}{' '}
            <button className="link" onClick={() => void openFile(step.path!, { preview: true })}>
              {basename(step.path)}
            </button>
          </>
        ) : (
          step.title
        )}
      </span>
      {step.detail && <span className="step-detail">{step.detail}</span>}
      {step.error && <span className="step-error-inline" title={step.error}>{step.error}</span>}
    </div>
  )
}

function Changes({ m }: { m: ChatMessage }) {
  const revert = useChat((s) => s.revert)
  const openDiff = useEditor((s) => s.openDiff)
  const rows = useMemo(
    () =>
      (m.changes ?? []).map((c: FileChange) => ({
        c,
        d: computeDiff(c.before ?? '', c.after ?? '')
      })),
    [m.changes]
  )
  if (!rows.length) return null
  const live = rows.filter((r) => !r.c.reverted)
  return (
    <div className="changes">
      <div className="changes-head">
        <span>
          {rows.length === 1 ? 'Changed 1 file' : `Changed ${rows.length} files`}
        </span>
        {live.length > 0 && (
          <button className="btn btn-plain btn-sm" onClick={() => void revert(m.id)}>
            <RotateCcw size={12} />
            <span>Undo all</span>
          </button>
        )}
      </div>
      {rows.map(({ c, d }) => (
        <div key={c.path} className={cx('change-row', c.reverted && 'is-reverted')}>
          <FileIcon path={c.path} size={13} />
          <span className="change-name" title={c.path}>
            {basename(c.path)}
          </span>
          <span className="diffstat">
            {c.before === null && !c.reverted && <span className="badge">new</span>}
            {c.after === null && <span className="badge">deleted</span>}
            {d.added > 0 && <span className="tone-sage">+{d.added}</span>}
            {d.removed > 0 && <span className="tone-rose">−{d.removed}</span>}
          </span>
          {c.reverted ? (
            <span className="change-state">undone</span>
          ) : (
            <span className="change-actions">
              {c.after !== null && (
                <button className="link" onClick={() => void openDiff(c.path, c.before ?? '', 'Changes made by the model in this turn')}>
                  Review
                </button>
              )}
              <button className="link" onClick={() => void revert(m.id, c.path)}>
                Undo
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function copyAnswer(m: ChatMessage): void {
  const text = (m.parts ?? [])
    .filter((p): p is Extract<AssistantPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n')
  void navigator.clipboard.writeText(text)
  toast('Copied the answer')
}

const AssistantMessage = memo(function AssistantMessage({ m, live, retryable }: { m: ChatMessage; live: boolean; retryable: boolean }) {
  const parts = m.parts ?? []
  const lastText = parts.map((p) => p.kind).lastIndexOf('text')
  const waiting = live && parts.length === 0
  return (
    <div className="msg-assistant">
      {waiting && (
        <div className="msg-waiting">
          <Ember state="warming" size={15} />
          <span>Warming up {shortModelName(splitModelId(m.modelId ?? '').name)}</span>
        </div>
      )}
      {parts.map((p, i) => {
        if (p.kind === 'text') return p.text.trim() ? <Markdown key={i} text={p.text} streaming={live && i === lastText} /> : null
        if (p.kind === 'thinking') return <Thinking key={i} part={p} live={live} />
        if (p.kind === 'notice')
          return (
            <div key={i} className="notice">
              {p.text}
            </div>
          )
        return <ToolStepView key={p.step.id} step={p.step} />
      })}
      {m.error && (
        <div className="msg-error">
          <CircleAlert size={14} />
          <span>{m.error}</span>
        </div>
      )}
      {!live && <Changes m={m} />}
      {!live && (m.stats || m.error) && (
        <div className="msg-foot">
          <span className="msg-stats">
            {[
              shortModelName(splitModelId(m.modelId ?? '').name),
              m.stats?.tokensPerSecond ? `${m.stats.tokensPerSecond.toFixed(m.stats.tokensPerSecond < 10 ? 1 : 0)} tok/s` : '',
              m.stats?.durationMs ? formatDuration(m.stats.durationMs) : '',
              m.stats?.loadMs && m.stats.loadMs > 1500 ? `loaded in ${formatDuration(m.stats.loadMs)}` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="msg-actions">
            {parts.some((p) => p.kind === 'text' && p.text.trim()) && (
              <button className="msg-action" title="Copy the answer" onClick={() => copyAnswer(m)}>
                <Copy size={12} strokeWidth={1.9} />
              </button>
            )}
            {retryable && (
              <button className="msg-action" title="Ask again" onClick={() => void useChat.getState().retry()}>
                <RotateCcw size={12} strokeWidth={1.9} />
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
})

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)
}

/** How full the model's context window was on the latest request of this chat. */
function ContextMeter() {
  const context = useChat((s) => {
    const thread = s.threads.find((t) => t.id === s.activeId)
    for (let i = (thread?.messages.length ?? 0) - 1; i >= 0; i--) {
      const m = thread!.messages[i]
      if (m.context) return m.context
    }
    return null
  })
  if (!context || !context.limit) return null
  const ratio = Math.min(1, context.used / context.limit)
  const r = 6
  const circumference = 2 * Math.PI * r
  return (
    <span
      className={cx('context-meter', ratio > 0.9 ? 'is-full' : ratio > 0.7 ? 'is-high' : '')}
      title={`The latest request filled about ${formatTokens(context.used)} of the ${formatTokens(context.limit)} tokens the model reads at once.${ratio > 0.7 ? ' Start a new chat for an unrelated task.' : ''}`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle className="context-track" cx="8" cy="8" r={r} />
        <circle className="context-fill" cx="8" cy="8" r={r} strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 8 8)" />
      </svg>
      {ratio > 0.5 && <span>{Math.round(ratio * 100)}%</span>}
    </span>
  )
}

function ModelPicker() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const models = chatModels(useModels((s) => s.models))
  const chatModel = useSettings((s) => s.settings.chatModel)
  const update = useSettings((s) => s.update)
  const current = models.find((m) => m.id === chatModel)
  return (
    <>
      <button ref={ref} className="model-pill" onClick={() => setOpen(!open)} title="Model for chat and agent">
        <span className="model-pill-name">{current ? shortModelName(current.name) : chatModel ? shortModelName(splitModelId(chatModel).name) : 'No model'}</span>
        <ChevronDown size={11} strokeWidth={2.2} />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} side="top" width={280}>
        <div className="menu-list">
          {models.length === 0 && <div className="menu-empty">No models found. Click the ember in the title bar to get one.</div>}
          {models.map((m) => (
            <button key={m.id} className={cx('menu-row', m.id === chatModel && 'is-on')} onClick={() => {
              void update({ chatModel: m.id })
              setOpen(false)
            }}>
              <div className="menu-row-main">
                <span className="menu-row-title">{shortModelName(m.name)}</span>
                <span className="menu-row-sub">
                  {[m.parameterSize, m.providerName, m.capabilities && !m.capabilities.includes('tools') ? 'no tools' : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
              {m.id === chatModel && <Check size={13} strokeWidth={2.4} className="tone-ember" />}
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

function MentionMenu({ query, onPick, index, setCount }: { query: string; onPick: (path: string) => void; index: number; setCount: (n: number) => void }) {
  const files = useWorkspace((s) => s.files)
  const ensure = useWorkspace((s) => s.ensureFiles)
  useEffect(() => {
    void ensure()
  }, [ensure])
  const results = useMemo(() => fuzzyFilter(files ?? [], query, (f) => f, 8), [files, query])
  useEffect(() => setCount(results.length), [results.length, setCount])
  if (!files) return <div className="mention-menu"><div className="menu-empty"><Spinner size={10} /> Indexing files</div></div>
  if (!results.length) return <div className="mention-menu"><div className="menu-empty">No matching files</div></div>
  return (
    <div className="mention-menu">
      {results.map((r, i) => (
        <button key={r.item} className={cx('mention-row', i === index && 'is-on')} onMouseDown={(e) => {
          e.preventDefault()
          onPick(r.item)
        }}>
          <FileIcon path={r.item} size={13} />
          <span className="mention-name">
            <Highlighted text={basename(r.item)} positions={r.positions.filter((p) => p >= r.item.length - basename(r.item).length).map((p) => p - (r.item.length - basename(r.item).length))} />
          </span>
          <span className="mention-dir">{dirname(r.item)}</span>
        </button>
      ))}
    </div>
  )
}

function Composer() {
  const draft = useChat((s) => s.draft)
  const chips = useChat((s) => s.chips)
  const mode = useChat((s) => s.mode)
  const running = useChat((s) => !!s.runningThread)
  const dismissed = useChat((s) => s.activeFileDismissed)
  const images = useChat((s) => s.images)
  const { setDraft, setMode, send, stop, removeChip, addChip, dismissActiveFile, addImages, removeImage } = useChat.getState()
  const imageModel = useSettings((s) => s.settings.imageModel)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const focusTick = useUi((s) => s.chatFocusTick)
  const chatModel = useSettings((s) => s.settings.chatModel)
  useModels((s) => s.models)
  const activeId = useEditor((s) => s.activeId)
  const tab = activeTab()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionCount, setMentionCount] = useState(0)

  useEffect(() => {
    ref.current?.focus()
  }, [focusTick])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [draft])

  const suggested = tab?.kind === 'file' && dismissed !== tab.path && !chips.some((c) => c.kind === 'file' && c.path === tab.path) ? tab.path : null
  void activeId

  const updateMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(^|\s)@([^\s@]*)$/.exec(before)
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] })
      setMentionIndex(0)
    } else setMention(null)
  }

  const pickMention = (path: string) => {
    if (!mention) return
    const el = ref.current
    const caret = el?.selectionStart ?? draft.length
    const before = draft.slice(0, mention.start)
    const after = draft.slice(caret)
    const next = before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after
    setDraft(next)
    addChip({ kind: 'file', path })
    setMention(null)
    setTimeout(() => {
      el?.focus()
      el?.setSelectionRange(mention.start, mention.start)
    }, 0)
  }

  const submit = () => {
    if (running) return
    if (!draft.trim() && !images.length) return
    void send(draft)
  }

  const attachFiles = (files: File[]) => {
    const pictures = files.filter(isImageFile)
    if (pictures.length) void addImages(pictures.map((f) => ({ blob: f, name: f.name || 'image.png' })))
    if (pictures.length < files.length) toast('Only images can be attached here. Type @ to attach a project file.')
  }

  const noTools = chatModel && !supportsTools(chatModel)
  const canSee = supportsVision(chatModel) || (!!imageModel && supportsVision(imageModel))
  useModels((s) => s.models)

  return (
    <div
      className="composer-wrap"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        attachFiles([...e.dataTransfer.files])
      }}
    >
      {mention && <MentionMenu query={mention.query} onPick={pickMention} index={mentionIndex} setCount={setMentionCount} />}
      <div className={cx('composer', running && 'is-running', dragging && 'is-dropping')}>
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((img, i) => (
              <span key={img.id} className="composer-image" title={`${img.name}, ${img.width} by ${img.height}`}>
                <img src={img.thumb} alt={img.name} onClick={() => useUi.setState({ lightbox: { id: img.id, name: img.name } })} />
                <button className="composer-image-x" aria-label="Remove image" onClick={() => removeImage(i)}>
                  <X size={10} strokeWidth={2.6} />
                </button>
              </span>
            ))}
            {!canSee && (
              <span className="composer-image-note">
                No installed model can see images. Get qwen3-vl:4b from the models panel.
              </span>
            )}
          </div>
        )}
        {(chips.length > 0 || suggested) && (
          <div className="composer-chips">
            {suggested && <ChipView chip={{ kind: 'file', path: suggested }} suggested onRemove={() => dismissActiveFile(suggested)} />}
            {chips.map((c, i) => (
              <ChipView key={i} chip={c} onRemove={() => removeChip(i)} />
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          className="composer-input"
          rows={1}
          value={draft}
          spellCheck={false}
          placeholder={mode === 'agent' ? 'Describe a change, or type @ to attach a file' : 'Ask about the code, or type @ to attach a file'}
          onChange={(e) => {
            setDraft(e.target.value)
            updateMention(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={(e) => {
            if (mention && mentionCount > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + mentionCount) % mentionCount)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                const files = useWorkspace.getState().files ?? []
                const pick = fuzzyFilter(files, mention.query, (f) => f, 8)[mentionIndex]
                if (pick) pickMention(pick.item)
                return
              }
            }
            if (e.key === 'Escape' && mention) {
              e.preventDefault()
              setMention(null)
              return
            }
            if (e.key === 'Escape' && running) {
              e.preventDefault()
              stop()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          onClick={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter(isImageFile)
            if (!files.length) return
            // A screenshot: attach it. Text that came along still pastes as usual.
            if (!e.clipboardData.getData('text/plain')) e.preventDefault()
            attachFiles(files)
          }}
        />
        <div className="composer-bar">
          <Segmented<ChatMode>
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'agent', label: 'Agent', title: 'Reads, edits and runs commands' },
              { value: 'ask', label: 'Ask', title: 'Reads and answers, changes nothing' }
            ]}
          />
          <ModelPicker />
          {noTools && <span className="composer-warning" title="This model cannot use tools">no tools</span>}
          <IconButton label="Attach an image (or paste or drop one)" className="sm composer-attach" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} strokeWidth={1.8} />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              attachFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <span className="spacer" />
          <ContextMeter />
          {running ? (
            <button className="send is-stop" onClick={stop} title="Stop">
              <Square size={11} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button className="send" disabled={!draft.trim() && !images.length} onClick={submit} title="Send  ↩">
              <ArrowUp size={15} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
