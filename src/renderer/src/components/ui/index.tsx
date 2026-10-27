import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Braces,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileLock2,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Settings2
} from 'lucide-react'
import { shortcutLabel } from '../../lib/keys'
import { extname, basename } from '../../lib/paths'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'plain' | 'tinted' | 'filled' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

export function Button({ variant = 'plain', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button {...rest} className={cx('btn', `btn-${variant}`, `btn-${size}`, className)}>
      {icon}
      {children !== undefined && <span>{children}</span>}
    </button>
  )
}

export function IconButton({
  label,
  shortcut,
  active,
  className,
  children,
  ...rest
}: ComponentProps<'button'> & { label: string; shortcut?: string; active?: boolean }) {
  return (
    <button {...rest} aria-label={label} title={shortcut ? `${label}  ${shortcutLabel(shortcut)}` : label} className={cx('icon-btn', active && 'is-active', className)}>
      {children}
    </button>
  )
}

export function Kbd({ combo }: { combo: string }) {
  return <kbd className="kbd">{shortcutLabel(combo)}</kbd>
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className={cx('segmented', `segmented-${size}`)} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} title={o.title} className={cx('segment', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={cx('toggle', checked && 'is-on')} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  )
}

export type EmberState = 'offline' | 'cold' | 'warming' | 'warm' | 'working'

/** The Hearth mark: an arch (the hearth) holding a text caret (the flame). */
export function Ember({ state = 'warm', size = 16 }: { state?: EmberState; size?: number }) {
  return (
    <svg className={cx('ember', `ember-${state}`)} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path className="ember-arch" d="M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5" fill="none" strokeWidth="1.9" strokeLinecap="round" />
      <path className="ember-floor" d="M3.5 20.5h17" fill="none" strokeWidth="1.9" strokeLinecap="round" />
      <rect className="ember-core" x="10.85" y="10.2" width="2.3" height="7.6" rx="1.15" />
    </svg>
  )
}

export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="logo-glow" cx="50%" cy="62%" r="40%">
          <stop offset="0%" stopColor="var(--ember-2)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--ember-2)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="logo-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ember-2)" />
          <stop offset="100%" stopColor="var(--ember)" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="40" rx="18" ry="16" fill="url(#logo-glow)" />
      <path d="M15 54V29a17 17 0 0 1 34 0v25" fill="none" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
      <path d="M9 54h46" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
      <rect x="29" y="27" width="6" height="21" rx="3" fill="url(#logo-core)" className="logo-core" />
    </svg>
  )
}

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.lua', '.dart', '.scala', '.vue', '.svelte', '.html', '.css', '.scss', '.less', '.sql', '.zig', '.ex', '.exs', '.hs', '.ml', '.r'])
const TINT: Record<string, string> = {
  '.ts': 'var(--sky)',
  '.tsx': 'var(--sky)',
  '.js': 'var(--amber)',
  '.jsx': 'var(--amber)',
  '.mjs': 'var(--amber)',
  '.json': 'var(--amber)',
  '.py': 'var(--sky)',
  '.rs': 'var(--ember)',
  '.go': 'var(--sky)',
  '.swift': 'var(--ember)',
  '.css': 'var(--rose)',
  '.scss': 'var(--rose)',
  '.html': 'var(--ember)',
  '.md': 'var(--text-2)'
}

export function FileIcon({ path, dir, open, size = 15 }: { path: string; dir?: boolean; open?: boolean; size?: number }) {
  const props = { size, strokeWidth: 1.6 }
  if (dir) return open ? <FolderOpen {...props} className="file-icon is-dir" /> : <Folder {...props} className="file-icon is-dir" />
  const ext = extname(path)
  const name = basename(path).toLowerCase()
  const style: CSSProperties = { color: TINT[ext] ?? 'var(--text-3)' }
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/.test(name)) return <FileImage {...props} className="file-icon" style={{ color: 'var(--sage)' }} />
  if (name.endsWith('.lock') || name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml') return <FileLock2 {...props} className="file-icon" />
  if (ext === '.json' || ext === '.jsonc') return <FileJson {...props} className="file-icon" style={style} />
  if (ext === '.md' || ext === '.mdx' || ext === '.txt' || ext === '.rst') return <FileText {...props} className="file-icon" style={style} />
  if (ext === '.sh' || ext === '.zsh' || ext === '.bash' || ext === '.ps1' || ext === '.bat' || ext === '.cmd') return <FileTerminal {...props} className="file-icon" />
  if (ext === '.yml' || ext === '.yaml' || ext === '.toml' || ext === '.ini' || name.startsWith('.env') || name.startsWith('.')) return <Settings2 {...props} className="file-icon" />
  if (ext === '.ttf' || ext === '.otf' || ext === '.woff' || ext === '.woff2') return <FileType {...props} className="file-icon" />
  if (ext === '.xml' || ext === '.graphql') return <Braces {...props} className="file-icon" />
  if (CODE_EXT.has(ext)) return <FileCode2 {...props} className="file-icon" style={style} />
  return <File {...props} className="file-icon" />
}

/** A floating panel anchored to an element, dismissed by Escape or a click outside. */
export function Popover({
  anchor,
  open,
  onClose,
  align = 'start',
  side = 'bottom',
  width,
  className,
  children
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  align?: 'start' | 'end' | 'center'
  side?: 'bottom' | 'top'
  width?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const el = ref.current
      const w = el?.offsetWidth ?? width ?? 280
      const h = el?.offsetHeight ?? 200
      let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = side === 'bottom' ? r.bottom + 6 : r.top - h - 6
      if (side === 'bottom' && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      if (side === 'top' && top < 8) top = r.bottom + 6
      setPos({ left, top })
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, align, side, width])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div ref={ref} className={cx('popover', className)} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}>
      {children}
    </div>,
    document.body
  )
}

export function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>
  const set = new Set(positions)
  const out: ReactNode[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== on && buf) {
      out.push(on ? <mark key={i}>{buf}</mark> : buf)
      buf = ''
    }
    on = hit
    buf += text[i]
  }
  if (buf) out.push(on ? <mark key="end">{buf}</mark> : buf)
  return <>{out}</>
}
