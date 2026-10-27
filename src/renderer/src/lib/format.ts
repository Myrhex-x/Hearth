export function formatBytes(n?: number): string {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s % 60)} s`
}

export function timeUntil(iso?: string): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms > 365 * 24 * 3600 * 1000) return 'stays warm'
  if (ms <= 0) return 'cooling now'
  const min = Math.round(ms / 60000)
  if (min < 1) return 'cools in under a minute'
  if (min < 60) return `cools in ${min} min`
  return `cools in ${Math.round(min / 60)} h`
}

export function relativeTime(ts: number): string {
  const d = Date.now() - ts
  const min = Math.round(d / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ts).toLocaleDateString()
}

/** "qwen2.5-coder:7b" -> { base: "qwen2.5-coder", tag: "7b" } */
export function splitModelName(name: string): { base: string; tag: string } {
  const slash = name.lastIndexOf('/')
  const short = slash >= 0 ? name.slice(slash + 1) : name
  const colon = short.indexOf(':')
  if (colon < 0) return { base: short, tag: '' }
  const tag = short.slice(colon + 1)
  return { base: short.slice(0, colon), tag: tag === 'latest' ? '' : tag }
}

export function shortModelName(name?: string | null): string {
  if (!name) return ''
  const { base, tag } = splitModelName(name)
  return tag ? `${base}:${tag}` : base
}
