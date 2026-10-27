import { ArrowDownToLine, X } from 'lucide-react'
import type { EngineCatalogEntry } from '../../../shared/engineCatalog'
import { recommendedChatModel } from '../../../shared/engineCatalog'
import { modelIdOf } from '../../../shared/types'
import { isMac } from '../api'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { Button, cx } from './ui'

// Models the built-in engine downloads. The size is always on the button, so
// nothing large starts without the person seeing how large it is.

function percent(completed?: number, total?: number): number {
  return total ? Math.floor(((completed ?? 0) / total) * 100) : 0
}

/** One model's download button, its progress while it runs, or nothing once it is installed. */
export function GetModel({ name, variant = 'tinted' }: { name: string; variant?: 'tinted' | 'filled' }) {
  const entry = useModels((s) => s.catalog.find((m) => m.name === name))
  const key = modelIdOf('builtin', name)
  const pull = useModels((s) => s.pulls[key])
  if (!entry || entry.installed) return null
  if (pull) {
    const pct = percent(pull.completed, pull.total)
    return (
      <span className="get-model">
        <span className="get-model-bar progress">
          <span className="progress-bar" style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <span className="get-model-pct">{pct}%</span>
        <button className="icon-btn sm" title="Stop. The download continues from here next time." onClick={() => useModels.getState().cancelPull(key)}>
          <X size={12} />
        </button>
      </span>
    )
  }
  return (
    <Button
      size="sm"
      variant={variant}
      icon={<ArrowDownToLine size={12} />}
      title={`${entry.label}: ${entry.note}. Downloads from Hugging Face and runs on this computer.`}
      onClick={() => useModels.getState().pull('builtin', name)}
    >
      {entry.partialBytes > 0 ? 'Resume' : 'Get'} {entry.label} · {formatBytes(entry.sizeBytes)}
    </Button>
  )
}

function CatalogRow({ m, recommended }: { m: EngineCatalogEntry; recommended: boolean }) {
  const key = modelIdOf('builtin', m.name)
  const pull = useModels((s) => s.pulls[key])
  const pct = pull ? percent(pull.completed, pull.total) : 0
  return (
    <div className={cx('catalog-row', pull && 'is-busy')}>
      <div className="catalog-main">
        <span className="catalog-name">
          {m.label}
          {recommended && <span className="catalog-badge">For this {isMac ? 'Mac' : 'PC'}</span>}
        </span>
        {pull ? (
          <span className="progress catalog-progress">
            <span className="progress-bar" style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
        ) : (
          <span className="catalog-note">{m.note}</span>
        )}
      </div>
      {pull ? (
        <span className="catalog-status">
          {pct}%
          <button className="icon-btn sm" title="Stop. The download continues from here next time." onClick={() => useModels.getState().cancelPull(key)}>
            <X size={12} />
          </button>
        </span>
      ) : (
        <button
          className="catalog-get"
          title={`Download ${m.label} from Hugging Face, ${formatBytes(m.sizeBytes)}`}
          onClick={() => useModels.getState().pull('builtin', m.name)}
        >
          <ArrowDownToLine size={12} />
          {m.partialBytes > 0 ? `Resume, ${percent(m.partialBytes, m.sizeBytes)}%` : formatBytes(m.sizeBytes)}
        </button>
      )}
    </div>
  )
}

/** Everything the engine can still download, with the model that suits this computer marked. */
export function Catalog() {
  const catalog = useModels((s) => s.catalog)
  const memory = useModels((s) => s.memoryBytes)
  const recommended = recommendedChatModel(memory)
  const rest = catalog.filter((m) => !m.installed)
  if (!rest.length) return null
  return (
    <div className="catalog">
      {rest.map((m) => (
        <CatalogRow key={m.name} m={m} recommended={m.name === recommended} />
      ))}
    </div>
  )
}
