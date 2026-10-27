import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { useUi } from '../state/ui'
import { cx } from './ui'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={cx('toast', `is-${t.tone}`)} onClick={() => dismiss(t.id)}>
          {t.tone === 'error' ? <CircleAlert size={14} /> : t.tone === 'success' ? <CircleCheck size={14} /> : <Info size={14} />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  )
}
