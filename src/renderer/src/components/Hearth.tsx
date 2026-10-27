import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Check, ExternalLink, RefreshCw, Snowflake, X } from 'lucide-react'
import type { ModelInfo } from '../../../shared/types'
import { splitModelId } from '../../../shared/types'
import { api } from '../api'
import { formatBytes, shortModelName, timeUntil } from '../lib/format'
import { chatModels, embeddingModels, useModels } from '../state/models'
import { useSettings } from '../state/settings'
import { useUi } from '../state/ui'
import { Button, Ember, Popover, Spinner, Toggle, cx, type EmberState } from './ui'

export function useEmber(): { state: EmberState; word: string } {
  const { statuses, loaded, activity, activityModel, liveTokens, ready } = useModels()
  const chatModel = useSettings((s) => s.settings.chatModel)
  return useMemo(() => {
    if (!ready) return { state: 'cold' as const, word: 'looking' }
    if (!chatModel) return { state: statuses.some((s) => s.ok) ? ('cold' as const) : ('offline' as const), word: statuses.some((s) => s.ok) ? 'no model' : 'offline' }
    const { providerId } = splitModelId(chatModel)
    const status = statuses.find((s) => s.id === providerId)
    if (status && !status.ok) return { state: 'offline' as const, word: 'offline' }
    if (activity === 'streaming') return { state: 'working' as const, word: liveTokens > 0 ? `${Math.round(liveTokens)} tok/s` : 'writing' }
    const isLoaded = status?.kind === 'openai' || loaded.some((l) => l.id === (activityModel ?? chatModel))
    if (activity === 'waiting') return { state: isLoaded ? ('working' as const) : ('warming' as const), word: isLoaded ? 'reading' : 'warming up' }
    if (status?.kind === 'openai') return { state: 'warm' as const, word: 'ready' }
    return loaded.some((l) => l.id === chatModel) ? { state: 'warm' as const, word: 'warm' } : { state: 'cold' as const, word: 'cold' }
  }, [statuses, loaded, activity, activityModel, liveTokens, ready, chatModel])
}

export function HearthIndicator() {
  const ref = useRef<HTMLButtonElement>(null)
  const open = useUi((s) => s.modelsOpen)
  const setOpen = useUi((s) => s.setModelsOpen)
  const chatModel = useSettings((s) => s.settings.chatModel)
  const { state, word } = useEmber()
  const name = chatModel ? shortModelName(splitModelId(chatModel).name) : 'Choose a model'
  return (
    <>
      <button ref={ref} className={cx('hearth-pill', `is-${state}`, open && 'is-open')} onClick={() => setOpen(!open)} title="Models on this computer">
        <Ember state={state} size={17} />
        <span className="hearth-pill-name">{name}</span>
        <span className="hearth-pill-word">{word}</span>
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} align="end" width={392} className="models-popover">
        <ModelsPanel />
      </Popover>
    </>
  )
}

const SUGGESTED = [
  { name: 'qwen2.5-coder:1.5b', note: 'Fast autocomplete', size: 'about 1 GB' },
  { name: 'qwen3-embedding:0.6b', note: 'Search by meaning', size: 'about 640 MB' },
  { name: 'qwen3-vl:4b', note: 'Reads images, uses tools', size: 'about 3.3 GB' },
  { name: 'qwen2.5-coder:7b', note: 'Autocomplete and chat', size: 'about 4.7 GB' },
  { name: 'qwen3:8b', note: 'Agent on 16 GB machines', size: 'about 5.2 GB' },
  { name: 'qwen3:14b', note: 'Stronger agent', size: 'about 9.3 GB' },
  { name: 'qwen3-coder:30b', note: 'Best agent, 32 GB or more', size: 'about 19 GB' },
  { name: 'gpt-oss:20b', note: 'Reasoning agent', size: 'about 14 GB' }
]

function Capabilities({ m }: { m: ModelInfo }) {
  if (!m.capabilities) return null
  const caps: string[] = []
  if (m.capabilities.includes('tools')) caps.push('tools')
  if (m.capabilities.includes('insert')) caps.push('fill-in')
  if (m.capabilities.includes('thinking')) caps.push('thinks')
  if (m.capabilities.includes('vision')) caps.push('vision')
  return (
    <span className="caps">
      {caps.map((c) => (
        <span key={c} className="cap">
          {c}
        </span>
      ))}
    </span>
  )
}

export function ModelsPanel() {
  const { models, statuses, loaded, pulls, refreshing, refresh, warm, unload, pull, cancelPull, activity } = useModels()
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const { state } = useEmber()
  const [name, setName] = useState('')
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const chat = models.find((m) => m.id === settings.chatModel)
  const chatLoaded = loaded.find((l) => l.id === settings.chatModel)
  const ollama = statuses.find((s) => s.kind === 'ollama' && s.ok)
  const anyOnline = statuses.some((s) => s.ok)
  const talkers = chatModels(models)
  const embedders = embeddingModels(models)
  const fim = talkers.filter((m) => !m.capabilities || m.capabilities.includes('insert'))
  const installed = new Set(models.map((m) => m.name))

  let headline: string
  let sub: string
  if (!anyOnline) {
    headline = 'No model server found'
    sub = 'Start Ollama, LM Studio or llama.cpp on this computer, then refresh.'
  } else if (!chat) {
    headline = models.length ? 'Pick a model to work with' : 'No models installed yet'
    sub = models.length ? 'Choose one below.' : 'Download one below to light the hearth.'
  } else if (chat.providerKind === 'openai') {
    headline = `${shortModelName(chat.name)} is ready`
    sub = `Served by ${chat.providerName}.`
  } else if (chatLoaded) {
    headline = `${shortModelName(chat.name)} is warm`
    sub = `In memory, ${formatBytes(chatLoaded.vramBytes || chatLoaded.sizeBytes)}, ${timeUntil(chatLoaded.expiresAt)}.`
  } else {
    headline = `${shortModelName(chat.name)} is cold`
    sub = 'It loads with your next message. Warming it now makes the first answer faster.'
  }

  return (
    <div className="models">
      <div className="models-head">
        <div className={cx('models-hearth', `is-${state}`)}>
          <Ember state={state} size={30} />
        </div>
        <div className="models-head-text">
          <div className="models-headline">{headline}</div>
          <div className="models-sub">{sub}</div>
        </div>
        <button className="icon-btn" title="Refresh" onClick={() => void refresh()}>
          {refreshing ? <Spinner /> : <RefreshCw size={14} />}
        </button>
      </div>
      {chat && chat.providerKind === 'ollama' && (
        <div className="models-head-actions">
          {chatLoaded ? (
            <Button size="sm" variant="tinted" icon={<Snowflake size={13} />} onClick={() => void unload(chat.id)}>
              Let it cool
            </Button>
          ) : (
            <Button size="sm" variant="filled" disabled={activity !== 'idle'} onClick={() => void warm(chat.id)}>
              {activity === 'waiting' ? 'Warming up' : 'Warm it up'}
            </Button>
          )}
        </div>
      )}

      {!anyOnline && (
        <div className="models-empty">
          <p>Hearth talks to a model server running on your computer. The easiest is Ollama.</p>
          <div className="row gap-6">
            <Button size="sm" variant="filled" icon={<ExternalLink size={13} />} onClick={() => api.app.openExternal('https://ollama.com/download')}>
              Get Ollama
            </Button>
            <Button size="sm" onClick={() => useUi.getState().openSettings('models')}>
              Server settings
            </Button>
          </div>
        </div>
      )}

      {talkers.length > 0 && (
        <section className="models-section">
          <div className="section-label">Chat and agent</div>
          <div className="model-list">
            {talkers.map((m) => {
              const l = loaded.find((x) => x.id === m.id)
              return (
                <button key={m.id} className={cx('model-row', m.id === settings.chatModel && 'is-on')} onClick={() => void update({ chatModel: m.id })}>
                  <span className="model-check">{m.id === settings.chatModel && <Check size={13} strokeWidth={2.4} />}</span>
                  <span className="model-main">
                    <span className="model-name">
                      {shortModelName(m.name)}
                      {l && <span className="warm-dot" title="In memory" />}
                    </span>
                    <span className="model-meta">
                      {[m.parameterSize, m.quantization, formatBytes(m.sizeBytes), statuses.length > 1 ? m.providerName : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Capabilities m={m} />
                </button>
              )
            })}
          </div>
        </section>
      )}

      {models.length > 0 && (
        <section className="models-section">
          <div className="section-label row between">
            <span>Autocomplete</span>
            <Toggle checked={settings.autocompleteEnabled} onChange={(v) => void update({ autocompleteEnabled: v })} label="Autocomplete" />
          </div>
          {fim.length ? (
            <select className="select" value={settings.autocompleteModel ?? ''} onChange={(e) => void update({ autocompleteModel: e.target.value || null })}>
              <option value="">None</option>
              {fim.map((m) => (
                <option key={m.id} value={m.id}>
                  {shortModelName(m.name)}
                </option>
              ))}
            </select>
          ) : (
            <p className="hint">Autocomplete needs a fill-in-the-middle model. qwen2.5-coder:1.5b is small and quick.</p>
          )}
        </section>
      )}

      {models.length > 0 && (
        <section className="models-section">
          <div className="section-label row between">
            <span>Search by meaning</span>
            <Toggle checked={settings.indexing} onChange={(v) => void update({ indexing: v })} label="Search by meaning" />
          </div>
          {embedders.length ? (
            <select className="select" value={settings.embeddingModel ?? ''} onChange={(e) => void update({ embeddingModel: e.target.value || null })}>
              <option value="">None</option>
              {embedders.map((m) => (
                <option key={m.id} value={m.id}>
                  {shortModelName(m.name)}
                </option>
              ))}
            </select>
          ) : (
            <p className="hint">Finding code by what it does needs a small embedding model. qwen3-embedding:0.6b understands code well.</p>
          )}
        </section>
      )}

      {ollama && (
        <section className="models-section">
          <div className="section-label">Download with Ollama</div>
          <form
            className="pull-form"
            onSubmit={(e) => {
              e.preventDefault()
              const n = name.trim()
              if (n) {
                pull(ollama.id, n)
                setName('')
              }
            }}
          >
            <input className="field" placeholder="Model name, like qwen2.5-coder:7b" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            <Button size="sm" variant="tinted" type="submit" icon={<ArrowDownToLine size={13} />} disabled={!name.trim()}>
              Get
            </Button>
          </form>
          {Object.values(pulls).map((p) => {
            const pct = p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : null
            return (
              <div key={p.name} className="pull">
                <div className="row between">
                  <span className="pull-name">{p.name}</span>
                  <span className="pull-status">
                    {pct !== null ? `${pct}%` : p.status}
                    <button className="icon-btn sm" title="Cancel" onClick={() => cancelPull(p.name)}>
                      <X size={12} />
                    </button>
                  </span>
                </div>
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${pct ?? 4}%` }} />
                </div>
              </div>
            )
          })}
          <div className="suggestions">
            {SUGGESTED.filter((s) => !installed.has(s.name) && !pulls[s.name]).map((s) => (
              <button key={s.name} className="suggestion" onClick={() => pull(ollama.id, s.name)} title={`Download ${s.name}, ${s.size}`}>
                <span className="suggestion-name">{s.name}</span>
                <span className="suggestion-note">
                  {s.note} · {s.size}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="models-foot">
        {statuses.map((s) => (
          <span key={s.id} className="server" title={s.ok ? s.baseUrl : (s.error ?? s.baseUrl)}>
            <span className={cx('dot', s.ok ? 'is-ok' : 'is-off')} />
            {s.name}
            {s.version ? ` ${s.version}` : ''}
          </span>
        ))}
        <button className="link" onClick={() => useUi.getState().openSettings('models')}>
          Servers…
        </button>
      </div>
    </div>
  )
}
