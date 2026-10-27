// The preset file tells llama-server's router which models exist and how to
// run each one. Options are its command line flags without the dashes.

export interface PresetModel {
  name: string
  model: string
  mmproj?: string
  options?: Record<string, string | number | boolean>
}

export interface PresetGlobals {
  contextWindow: number
  /** Seconds idle before a model leaves memory; -1 keeps it until told otherwise. */
  sleepSeconds: number
}

/** Forward slashes: Windows accepts them, and nothing can read them as escapes. */
function pathValue(p: string): string {
  return p.replace(/\\/g, '/')
}

export function presetText(models: PresetModel[], g: PresetGlobals): string {
  const lines = ['version = 1', '', '[*]', `c = ${g.contextWindow}`]
  if (g.sleepSeconds > 0) lines.push(`sleep-idle-seconds = ${g.sleepSeconds}`)
  for (const m of models) {
    lines.push('', `[${m.name}]`, `model = ${pathValue(m.model)}`)
    if (m.mmproj) lines.push(`mmproj = ${pathValue(m.mmproj)}`)
    for (const [key, v] of Object.entries(m.options ?? {})) lines.push(`${key} = ${typeof v === 'boolean' ? String(v) : v}`)
  }
  return lines.join('\n') + '\n'
}

/** Ollama-style durations ("30m", "2h", "-1") in seconds, -1 meaning never. */
export function keepAliveSeconds(keepAlive: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(keepAlive)
  if (!m) return 1800
  const n = parseFloat(m[1])
  if (n < 0) return -1
  const unit = m[2] ?? 's'
  const seconds = unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : unit === 'ms' ? n / 1000 : n
  return Math.max(1, Math.round(seconds))
}
