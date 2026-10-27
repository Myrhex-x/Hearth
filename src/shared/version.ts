/** True when version `a` (like "0.2.1" or "v0.3.0") is newer than `b`. Pre-releases count as older. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, '').split('-', 2)
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? '' }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (x.pre === y.pre) return false
  if (!x.pre) return true
  if (!y.pre) return false
  return x.pre > y.pre
}
