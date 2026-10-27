import { useEffect, useState, type ReactNode } from 'react'
import { Check, ExternalLink, FolderOpen, X } from 'lucide-react'
import type { RecentWorkspace } from '../../../shared/types'
import { api } from '../api'
import { relativeTime, shortModelName } from '../lib/format'
import { shortcutLabel } from '../lib/keys'
import { useModels } from '../state/models'
import { openFolder } from '../state/session'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { useEmber } from './Hearth'
import { GetModel } from './EngineModels'
import { recommendedChatModel } from '../../../shared/engineCatalog'
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
  const { statuses, models, ready, refreshing, refresh, catalog, memoryBytes } = useModels()
  const settings = useSettings((s) => s.settings)
  const { state } = useEmber()
  const engine = statuses.find((s) => s.kind === 'builtin' && s.ok)
  const server = statuses.find((s) => s.kind !== 'builtin' && s.ok)
  const chat = models.find((m) => m.id === settings.chatModel)
  const auto = models.find((m) => m.id === settings.autocompleteModel)
  const meaning = models.find((m) => m.id === settings.embeddingModel)
  const canGet = !!engine && catalog.length > 0
  const memory = memoryBytes ? `${Math.round(memoryBytes / 1024 ** 3)} GB` : ''
  const offer = (text: string, name: string, variant?: 'filled') => (
    <span className="kindle-row">
      <span>{text}</span>
      <GetModel name={name} variant={variant} />
    </span>
  )

  return (
    <div className={cx('kindling', `is-${state}`)}>
      <div className="kindling-head">
        <span>Your hearth</span>
        <button className="link" onClick={() => void refresh()}>
          {refreshing ? 'Checking' : 'Check again'}
        </button>
      </div>
      <Step done={!!chat} busy={!ready} title="A model for the agent">
        {chat ? (
          <>{shortModelName(chat.name)} will read, edit and answer.</>
        ) : canGet ? (
          offer(`It runs on this computer.${memory ? ` Sized for its ${memory} of memory.` : ''}`, recommendedChatModel(memoryBytes), 'filled')
        ) : (
          <>
            This copy of Hearth has no built-in engine. Start Ollama, LM Studio or llama.cpp instead.{' '}
            <button className="link" onClick={() => api.app.openExternal('https://ollama.com/download')}>
              Get Ollama <ExternalLink size={11} />
            </button>
          </>
        )}
      </Step>
      <Step done={!!auto} title="A small model for autocomplete">
        {auto ? <>{shortModelName(auto.name)} fills in as you type.</> : canGet ? offer('Optional, and quick to download.', 'qwen2.5-coder:1.5b') : 'Optional.'}
      </Step>
      <Step done={!!meaning} title="Search by meaning">
        {meaning ? <>{shortModelName(meaning.name)} finds code by what it does.</> : canGet ? offer('Optional. Finds code by what it does.', 'qwen3-embedding:0.6b') : 'Optional.'}
      </Step>
      <div className="kindling-foot">
        Models run inside Hearth, on this computer, and your code never leaves it.{' '}
        {server ? `${server.name} is running too: its models are listed alongside.` : 'Already use Ollama or LM Studio? Hearth finds them on its own.'}
      </div>
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
