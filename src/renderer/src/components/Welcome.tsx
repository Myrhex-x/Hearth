import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Check, ExternalLink, FolderOpen, X } from 'lucide-react'
import type { RecentWorkspace } from '../../../shared/types'
import { api } from '../api'
import { relativeTime, shortModelName } from '../lib/format'
import { shortcutLabel } from '../lib/keys'
import { useModels } from '../state/models'
import { openFolder } from '../state/session'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { useEmber } from './Hearth'
import { Button, Logo, Spinner, cx } from './ui'

function Step({ done, busy, title, children }: { done: boolean; busy?: boolean; title: string; children: ReactNode }) {
  return (
    <div className={cx('kindle-step', done && 'is-done')}>
      <span className="kindle-mark">{busy ? <Spinner size={11} /> : done ? <Check size={12} strokeWidth={2.6} /> : null}</span>
      <div className="kindle-body">
        <div className="kindle-title">{title}</div>
        <div className="kindle-detail">{children}</div>
      </div>
    </div>
  )
}

function Kindling() {
  const { statuses, models, ready, pulls, pull, refreshing, refresh } = useModels()
  const settings = useSettings((s) => s.settings)
  const { state } = useEmber()
  const server = statuses.find((s) => s.ok)
  const ollama = statuses.find((s) => s.kind === 'ollama' && s.ok)
  const chat = models.find((m) => m.id === settings.chatModel)
  const auto = models.find((m) => m.id === settings.autocompleteModel)
  const pullButton = (name: string, label: string) =>
    ollama &&
    (pulls[name] ? (
      <span className="kindle-progress">
        <Spinner size={10} /> {pulls[name].total ? `${Math.round(((pulls[name].completed ?? 0) / pulls[name].total!) * 100)}%` : 'Starting'}
      </span>
    ) : (
      <Button size="sm" variant="tinted" icon={<ArrowDownToLine size={12} />} onClick={() => pull(ollama.id, name)}>
        {label}
      </Button>
    ))

  return (
    <div className={cx('kindling', `is-${state}`)}>
      <div className="kindling-head">
        <span>Your hearth</span>
        <button className="link" onClick={() => void refresh()}>
          {refreshing ? 'Checking' : 'Check again'}
        </button>
      </div>
      <Step done={!!server} busy={!ready} title="A model server on this computer">
        {server ? (
          <>
            {server.name}
            {server.version ? ` ${server.version}` : ''} is running.
          </>
        ) : (
          <>
            Hearth works with Ollama, LM Studio and llama.cpp.{' '}
            <button className="link" onClick={() => api.app.openExternal('https://ollama.com/download')}>
              Get Ollama <ExternalLink size={11} />
            </button>
          </>
        )}
      </Step>
      <Step done={!!chat} title="A model for the agent">
        {chat ? (
          <>{shortModelName(chat.name)} will read, edit and answer.</>
        ) : server ? (
          <span className="kindle-row">
            <span>A model that can use tools.</span>
            {pullButton('qwen3:8b', 'Get qwen3:8b')}
          </span>
        ) : (
          'Comes after the server.'
        )}
      </Step>
      <Step done={!!auto} title="A small model for autocomplete">
        {auto ? (
          <>{shortModelName(auto.name)} fills in as you type.</>
        ) : server ? (
          <span className="kindle-row">
            <span>Optional, and quick to download.</span>
            {pullButton('qwen2.5-coder:1.5b', 'Get qwen2.5-coder:1.5b')}
          </span>
        ) : (
          'Optional.'
        )}
      </Step>
      <div className="kindling-foot">Your code and your prompts stay on this computer. Hearth only talks to the model servers listed in Settings.</div>
      <button className="link kindling-more" onClick={() => useUi.getState().setModelsOpen(true)}>
        All models
      </button>
    </div>
  )
}

export function Welcome() {
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  useEffect(() => {
    void api.workspace.recent().then(setRecent)
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-left">
          <Logo size={68} />
          <h1 className="welcome-title">Hearth</h1>
          <p className="welcome-tagline">A code editor for models that live on your machine.</p>
          <div className="welcome-actions">
            <Button variant="filled" size="lg" icon={<FolderOpen size={16} />} onClick={() => void openFolder()}>
              Open a folder
            </Button>
            <span className="welcome-hint">{shortcutLabel('mod+o')}</span>
          </div>
          {recent.length > 0 && (
            <div className="recent">
              <div className="section-label">Recent</div>
              {recent.slice(0, 7).map((r) => (
                <div key={r.root} className="recent-row" onClick={() => void openFolder(r.root)} title={r.root}>
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.root}</span>
                  <span className="recent-time">{relativeTime(r.openedAt)}</span>
                  <button
                    className="icon-btn sm recent-x"
                    title="Remove from list"
                    onClick={(e) => {
                      e.stopPropagation()
                      void api.workspace.forgetRecent(r.root).then(() => setRecent((list) => list.filter((x) => x.root !== r.root)))
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <Kindling />
      </div>
    </div>
  )
}
