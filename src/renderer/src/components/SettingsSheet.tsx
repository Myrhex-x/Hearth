import { useEffect, useState, type ReactNode } from 'react'
import { Bot, Code2, Info, Paintbrush, ScanSearch, Server, Sparkles, Trash2, X } from 'lucide-react'
import type { AppInfo, ProviderConfig, ProviderKind } from '../../../shared/types'
import { api, isStore, uid } from '../api'
import { formatBytes, shortModelName } from '../lib/format'
import { checkForUpdates } from '../lib/updates'
import { chatModels, embeddingModels, useModels, visionModels } from '../state/models'
import { useMeaning } from '../state/meaning'
import { useWorkspace } from '../state/workspace'
import { useSettings } from '../state/settings'
import { useUi, type SettingsSection } from '../state/ui'
import { Button, IconButton, Logo, Segmented, Toggle, cx } from './ui'

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Paintbrush size={15} strokeWidth={1.7} /> },
  { id: 'models', label: 'Models', icon: <Server size={15} strokeWidth={1.7} /> },
  { id: 'agent', label: 'Agent', icon: <Bot size={15} strokeWidth={1.7} /> },
  { id: 'autocomplete', label: 'Autocomplete', icon: <Sparkles size={15} strokeWidth={1.7} /> },
  { id: 'search', label: 'Search', icon: <ScanSearch size={15} strokeWidth={1.7} /> },
  { id: 'editor', label: 'Editor', icon: <Code2 size={15} strokeWidth={1.7} /> },
  { id: 'about', label: 'About', icon: <Info size={15} strokeWidth={1.7} /> }
]

function Group({ title, children, note }: { title?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="group">
      {title && <div className="group-title">{title}</div>}
      <div className="group-box">{children}</div>
      {note && <div className="group-note">{note}</div>}
    </div>
  )
}

function Row({ label, detail, children }: { label: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {detail && <div className="setting-detail">{detail}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Stepper({ value, min, max, step = 1, onChange, suffix }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min}>
        −
      </button>
      <span>
        {value}
        {suffix}
      </span>
      <button onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max}>
        +
      </button>
    </div>
  )
}

function ProviderRow({ p }: { p: ProviderConfig }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const status = useModels((s) => s.statuses.find((x) => x.id === p.id))
  const [url, setUrl] = useState(p.baseUrl)
  const [key, setKey] = useState(p.apiKey ?? '')
  const save = (patch: Partial<ProviderConfig>) =>
    void update({ providers: settings.providers.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }).then(() => useModels.getState().refresh())
  const isDefault = ['builtin', 'ollama', 'lmstudio', 'llamacpp'].includes(p.id)
  const kindLabel = p.kind === 'builtin' ? 'llama.cpp, inside Hearth' : p.kind === 'ollama' ? 'Ollama' : 'OpenAI compatible'
  return (
    <div className="provider">
      <div className="provider-top">
        <span className={cx('dot', !p.enabled ? '' : status?.ok ? 'is-ok' : 'is-off')} />
        <span className="provider-name">{p.name}</span>
        <span className="provider-kind">{kindLabel}</span>
        <span className="provider-status">
          {!p.enabled ? 'Off' : status?.ok ? (p.kind === 'builtin' ? (status.version ?? 'Ready') : `Connected${status.version ? `, ${status.version}` : ''}`) : p.kind === 'builtin' ? 'Missing' : 'Not reachable'}
        </span>
        {!isDefault && (
          <IconButton label="Remove server" className="sm" onClick={() => void update({ providers: settings.providers.filter((x) => x.id !== p.id) })}>
            <Trash2 size={13} />
          </IconButton>
        )}
        <Toggle checked={p.enabled} onChange={(v) => save({ enabled: v })} label={`Use ${p.name}`} />
      </div>
      {p.enabled && p.kind !== 'builtin' && (
        <div className="provider-fields">
          <input className="field mono" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== p.baseUrl && save({ baseUrl: url.trim() })} />
          {p.kind === 'openai' && (
            <input
              className="field"
              type="password"
              placeholder="API key (usually not needed locally)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={() => key !== (p.apiKey ?? '') && save({ apiKey: key.trim() || undefined })}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Models the built-in engine downloaded, with the space they take. */
function Downloaded() {
  const catalog = useModels((x) => x.catalog)
  const remove = useModels((x) => x.removeBuiltin)
  const [busy, setBusy] = useState<string | null>(null)
  const installed = catalog.filter((m) => m.installed)
  const total = installed.reduce((sum, m) => sum + m.sizeBytes, 0)
  const reveal = (
    <button className="link" onClick={() => void api.engine.reveal()}>
      Show the folder
    </button>
  )
  if (!installed.length) {
    return <Group title="Downloaded models" note={<>Models you download from the models panel are kept in Hearth's data folder. {reveal}</>}>{<div className="setting-row muted">None yet.</div>}</Group>
  }
  return (
    <Group title="Downloaded models" note={<>{formatBytes(total)} in Hearth's data folder. {reveal}</>}>
      {installed.map((m) => (
        <Row key={m.name} label={m.label} detail={`${m.note}. ${formatBytes(m.sizeBytes)}`}>
          <Button
            size="sm"
            disabled={busy === m.name}
            onClick={async () => {
              const choice = await api.app.messageBox({
                type: 'warning',
                message: `Remove ${m.label}?`,
                detail: `This frees ${formatBytes(m.sizeBytes)}. You can download it again later.`,
                buttons: ['Remove', 'Cancel'],
                defaultId: 1,
                cancelId: 1
              })
              if (choice !== 0) return
              setBusy(m.name)
              await remove(m.name)
              setBusy(null)
            }}
          >
            {busy === m.name ? 'Removing' : 'Remove'}
          </Button>
        </Row>
      ))}
    </Group>
  )
}

/** Store edition: Apple's sandbox keeps ~/.gitconfig out of reach, so commits take their author from here. */
function SourceControl() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const [name, setName] = useState(s.gitName)
  const [email, setEmail] = useState(s.gitEmail)
  return (
    <Group title="Source control" note="Commits made from Hearth use this name and email.">
      <Row label="Name">
        <input className="field" value={name} placeholder="Ada Lovelace" spellCheck={false} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.gitName && void update({ gitName: name.trim() })} />
      </Row>
      <Row label="Email">
        <input className="field" value={email} placeholder="ada@example.com" spellCheck={false} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== s.gitEmail && void update({ gitEmail: email.trim() })} />
      </Row>
    </Group>
  )
}

function AddProvider() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ProviderKind>('openai')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('http://127.0.0.1:8000/v1')
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Add a server
      </Button>
    )
  return (
    <div className="add-provider">
      <Segmented<ProviderKind>
        size="sm"
        value={kind}
        onChange={(k) => {
          setKind(k)
          setUrl(k === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8000/v1')
        }}
        options={[
          { value: 'openai', label: 'OpenAI compatible' },
          { value: 'ollama', label: 'Ollama' }
        ]}
      />
      <input className="field" placeholder="Name, like vLLM on the desk PC" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="field mono" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      <div className="row gap-6">
        <Button size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="filled"
          disabled={!url.trim()}
          onClick={() => {
            const p: ProviderConfig = { id: uid('srv'), kind, name: name.trim() || (kind === 'ollama' ? 'Ollama' : 'Server'), baseUrl: url.trim(), enabled: true }
            void update({ providers: [...settings.providers, p] }).then(() => useModels.getState().refresh())
            setOpen(false)
            setName('')
          }}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

function General() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  return (
    <>
      <Group title="Appearance">
        <Row label="Theme" detail="Coal when dark, paper when light.">
          <Segmented
            size="sm"
            value={s.theme}
            onChange={(v) => void update({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </Row>
      </Group>
      <Group title="Layout">
        <Row label="Show the sidebar">
          <Toggle checked={s.layout.sidebarVisible} onChange={(v) => void update({ layout: { sidebarVisible: v } })} />
        </Row>
        <Row label="Show the chat">
          <Toggle checked={s.layout.chatVisible} onChange={(v) => void update({ layout: { chatVisible: v } })} />
        </Row>
      </Group>
    </>
  )
}

function Models() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const all = useModels((x) => x.models)
  const models = chatModels(all)
  const seers = visionModels(all)
  return (
    <>
      <Group title="Model servers" note="The built-in engine runs inside Hearth. Hearth only connects to the other servers listed here.">
        {s.providers.map((p) => (
          <ProviderRow key={p.id} p={p} />
        ))}
        <div className="setting-row">
          <AddProvider />
        </div>
      </Group>
      <Downloaded />
      <Group title="Chat and agent">
        <Row label="Model">
          <select className="select" value={s.chatModel ?? ''} onChange={(e) => void update({ chatModel: e.target.value || null })}>
            {!s.chatModel && <option value="">Choose a model</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {shortModelName(m.name)} ({m.providerName})
              </option>
            ))}
          </select>
        </Row>
        <Row label="Model for inline edits" detail="Used by Edit Selection with AI. Defaults to the chat model.">
          <select className="select" value={s.inlineEditModel ?? ''} onChange={(e) => void update({ inlineEditModel: e.target.value || null })}>
            <option value="">Same as chat</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {shortModelName(m.name)}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Model for images"
          detail={seers.length ? 'When the chat model cannot see, this one describes your images for it.' : 'Install a model that can see, like qwen3-vl:4b, to use images with any chat model.'}
        >
          <select className="select" value={s.imageModel ?? ''} disabled={!seers.length} onChange={(e) => void update({ imageModel: e.target.value || null })}>
            <option value="">{seers.length ? 'None' : 'No model can see yet'}</option>
            {seers.map((m) => (
              <option key={m.id} value={m.id}>
                {shortModelName(m.name)}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Context window" detail="How much text the model reads at once. Larger needs more memory. For built-in models and Ollama.">
          <select className="select" value={s.contextWindow} onChange={(e) => void update({ contextWindow: Number(e.target.value) })}>
            {[4096, 8192, 16384, 32768, 65536, 131072].map((n) => (
              <option key={n} value={n}>
                {n / 1024}K tokens
              </option>
            ))}
          </select>
        </Row>
        <Row label="Temperature" detail="Each model ships with settings tuned by its makers. Override them only if answers feel too random or too repetitive.">
          <div className="row gap-6">
            {s.temperature !== null && (
              <div className="slider">
                <input type="range" min={0} max={1.2} step={0.05} value={s.temperature} onChange={(e) => void update({ temperature: Number(e.target.value) })} />
                <span>{s.temperature.toFixed(2)}</span>
              </div>
            )}
            <Segmented
              size="sm"
              value={s.temperature === null ? 'model' : 'custom'}
              onChange={(v) => void update({ temperature: v === 'model' ? null : 0.4 })}
              options={[
                { value: 'model', label: 'Model' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </div>
        </Row>
        <Row label="Keep models warm" detail="How long a model stays in memory after you use it.">
          <select className="select" value={s.keepAlive} onChange={(e) => void update({ keepAlive: e.target.value })}>
            <option value="5m">5 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="2h">2 hours</option>
            <option value="-1">Until I let it cool</option>
          </select>
        </Row>
        <Row label="Let reasoning models think" detail="Models like qwen3 and gpt-oss reason before answering. Slower, often better.">
          <Toggle checked={s.showThinking} onChange={(v) => void update({ showThinking: v })} />
        </Row>
      </Group>
    </>
  )
}

function Agent() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  return (
    <Group title="What the agent may do on its own" note="Every change can be reviewed and undone from the chat, file by file.">
      <Row label="Apply edits without asking" detail="When off, each edit waits for you to apply or decline it.">
        <Toggle checked={s.agent.autoApplyEdits} onChange={(v) => void update({ agent: { autoApplyEdits: v } })} />
      </Row>
      {!isStore && (
        <Row label="Run commands without asking" detail="Off is safer: commands can change files outside the project or reach the network.">
          <Toggle checked={s.agent.autoRunCommands} onChange={(v) => void update({ agent: { autoRunCommands: v } })} />
        </Row>
      )}
      <Row label="Steps per request" detail="The agent pauses after this many model calls.">
        <Stepper value={s.agent.maxSteps} min={4} max={80} step={4} onChange={(v) => void update({ agent: { maxSteps: v } })} />
      </Row>
    </Group>
  )
}

function Autocomplete() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const models = useModels((x) => x.models)
  const fim = chatModels(models).filter((m) => !m.capabilities || m.capabilities.includes('insert'))
  return (
    <Group title="Autocomplete" note="Suggestions appear as faded text. Press Tab to accept. A small code model (1.5B to 7B) keeps it quick.">
      <Row label="Suggest as I type">
        <Toggle checked={s.autocompleteEnabled} onChange={(v) => void update({ autocompleteEnabled: v })} />
      </Row>
      <Row label="Model" detail="Needs a model that can fill in the middle, like qwen2.5-coder or starcoder2.">
        <select className="select" value={s.autocompleteModel ?? ''} onChange={(e) => void update({ autocompleteModel: e.target.value || null })}>
          <option value="">None</option>
          {fim.map((m) => (
            <option key={m.id} value={m.id}>
              {shortModelName(m.name)}
            </option>
          ))}
        </select>
      </Row>
    </Group>
  )
}

function Search() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const models = useModels((x) => x.models)
  const status = useMeaning((x) => x.status)
  const project = useWorkspace((x) => x.info)
  const embedders = embeddingModels(models)
  const state =
    status.state === 'ready'
      ? `${status.files.toLocaleString()} files, ${status.chunks.toLocaleString()} pieces`
      : status.state === 'indexing'
        ? status.total
          ? `Indexing ${status.done.toLocaleString()} of ${status.total.toLocaleString()} files`
          : 'Looking for changes'
        : status.state === 'error'
          ? (status.error ?? 'Failed')
          : status.state === 'no-model'
            ? 'Waiting for an embedding model'
            : 'Off'
  return (
    <>
      <Group
        title="Search by meaning"
        note="Hearth cuts your project into pieces and turns each into numbers with a small local model, so you and the agent can find code by what it does. The index stays in Hearth's data folder on this computer."
      >
        <Row label="Index projects" detail="Updates in the background as files change.">
          <Toggle checked={s.indexing} onChange={(v) => void update({ indexing: v })} />
        </Row>
        <Row label="Embedding model" detail={embedders.length ? 'qwen3-embedding:0.6b understands code well. nomic-embed-text is the smallest.' : 'Get qwen3-embedding:0.6b (about 640 MB) from the models panel.'}>
          <select className="select" value={s.embeddingModel ?? ''} disabled={!embedders.length} onChange={(e) => void update({ embeddingModel: e.target.value || null })}>
            <option value="">{embedders.length ? 'None' : 'No embedding model yet'}</option>
            {embedders.map((m) => (
              <option key={m.id} value={m.id}>
                {shortModelName(m.name)}
              </option>
            ))}
          </select>
        </Row>
        {project && (
          <Row label={`This project: ${project.name}`} detail={state}>
            <Button size="sm" disabled={!s.indexing || !s.embeddingModel || status.state === 'indexing'} onClick={() => void useMeaning.getState().rebuild()}>
              Rebuild
            </Button>
          </Row>
        )}
      </Group>
    </>
  )
}

function Editor() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  return (
    <>
      <Group title="Editor">
        <Row label="Font size">
          <Stepper value={s.editor.fontSize} min={10} max={24} onChange={(v) => void update({ editor: { fontSize: v } })} suffix=" pt" />
        </Row>
        <Row label="Tab size">
          <Segmented
            size="sm"
            value={String(s.editor.tabSize)}
            onChange={(v) => void update({ editor: { tabSize: Number(v) } })}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: '8', label: '8' }
            ]}
          />
        </Row>
        <Row label="Wrap long lines">
          <Toggle checked={s.editor.wordWrap} onChange={(v) => void update({ editor: { wordWrap: v } })} />
        </Row>
        <Row label="Line numbers">
          <Toggle checked={s.editor.lineNumbers} onChange={(v) => void update({ editor: { lineNumbers: v } })} />
        </Row>
        <Row label="Minimap">
          <Toggle checked={s.editor.minimap} onChange={(v) => void update({ editor: { minimap: v } })} />
        </Row>
      </Group>
      {isStore && <SourceControl />}
      {!isStore && (
        <Group title="Terminal">
          <Row label="Font size">
            <Stepper value={s.terminal.fontSize} min={9} max={22} onChange={(v) => void update({ terminal: { fontSize: v } })} suffix=" pt" />
          </Row>
        </Group>
      )}
    </>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    void api.app.info().then(setInfo)
  }, [])
  return (
    <div className="about">
      <Logo size={64} />
      <div className="about-name">Hearth</div>
      <div className="about-version">
        Version {info?.version} · {info?.osName}
      </div>
      <p className="about-text">An open source code editor for models that run on your own computer. Made by Myrhex, released under the MIT license.</p>
      <div className="row gap-6">
        <Button size="sm" onClick={() => api.app.openExternal('https://github.com/Myrhex-x/Hearth')}>
          Source code
        </Button>
        <Button size="sm" onClick={() => api.app.openExternal('https://github.com/Myrhex-x/Hearth/issues')}>
          Report an issue
        </Button>
        {!isStore && (
          <Button
            size="sm"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              await checkForUpdates()
              setChecking(false)
            }}
          >
            {checking ? 'Checking' : 'Check for updates'}
          </Button>
        )}
      </div>
      <p className="about-note">
        {isStore
          ? 'Hearth contacts Hugging Face only when you download a model. Everything else stays on this computer.'
          : 'Hearth contacts Hugging Face only when you download a model, and GitHub only when you check for updates. Everything else stays on this computer.'}
      </p>
    </div>
  )
}

export function SettingsSheet() {
  const section = useUi((s) => s.settings)
  const close = useUi((s) => s.closeSettings)
  useEffect(() => {
    if (!section) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section, close])
  if (!section) return null
  return (
    <div className="scrim is-sheet" onMouseDown={close}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <nav className="sheet-nav">
          <div className="sheet-nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={cx('sheet-nav-item', s.id === section && 'is-on')} onClick={() => useUi.setState({ settings: s.id })}>
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="sheet-content">
          <div className="sheet-head">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <IconButton label="Close" onClick={close}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="sheet-scroll">
            {section === 'general' && <General />}
            {section === 'models' && <Models />}
            {section === 'agent' && <Agent />}
            {section === 'autocomplete' && <Autocomplete />}
            {section === 'search' && <Search />}
            {section === 'editor' && <Editor />}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  )
}
