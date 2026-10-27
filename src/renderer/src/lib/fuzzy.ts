// Fuzzy matcher for quick open, the command palette and @ mentions.
// Finds the best alignment of the query in the text (dynamic programming),
// rewarding consecutive letters, word starts and matches in the file name.

export interface FuzzyResult {
  score: number
  positions: number[]
}

const NEG = -1e9
let scoreBuf = new Float64Array(0)
let backBuf = new Int32Array(0)

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  const cur = text[i]
  if (prev === '/' || prev === '\\' || prev === '-' || prev === '_' || prev === '.' || prev === ' ') return true
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase()
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const n = t.length
  const m = q.length
  if (m > n) return null

  // Cheap rejection before the full alignment.
  let qi = 0
  for (let k = 0; k < n && qi < m; k++) if (t[k] === q[qi]) qi++
  if (qi < m) return null

  const nameStart = text.lastIndexOf('/') + 1
  if (scoreBuf.length < m * n) {
    scoreBuf = new Float64Array(m * n * 2)
    backBuf = new Int32Array(m * n * 2)
  }
  const bonus = (k: number) => (isBoundary(text, k) ? 8 : 0) + (k >= nameStart ? 3 : 0)

  for (let j = 0; j < n; j++) {
    scoreBuf[j] = t[j] === q[0] ? 1 + bonus(j) : NEG
    backBuf[j] = -1
  }
  for (let i = 1; i < m; i++) {
    const row = i * n
    const prevRow = (i - 1) * n
    let bestPrev = NEG
    let bestIdx = -1
    for (let j = 0; j < n; j++) {
      if (j >= 2 && scoreBuf[prevRow + j - 2] > bestPrev) {
        bestPrev = scoreBuf[prevRow + j - 2]
        bestIdx = j - 2
      }
      if (t[j] !== q[i]) {
        scoreBuf[row + j] = NEG
        backBuf[row + j] = -1
        continue
      }
      const adjacent = j >= 1 ? scoreBuf[prevRow + j - 1] : NEG
      const consec = adjacent > NEG / 2 ? adjacent + 1 + bonus(j) + 6 : NEG
      const gap = bestIdx >= 0 && bestPrev > NEG / 2 ? bestPrev + bonus(j) - 1 : NEG
      if (consec >= gap) {
        scoreBuf[row + j] = consec
        backBuf[row + j] = j - 1
      } else {
        scoreBuf[row + j] = gap
        backBuf[row + j] = bestIdx
      }
    }
  }

  const last = (m - 1) * n
  let best = NEG
  let end = -1
  for (let j = 0; j < n; j++) {
    if (scoreBuf[last + j] > best) {
      best = scoreBuf[last + j]
      end = j
    }
  }
  if (end < 0 || best <= NEG / 2) return null

  const positions = new Array<number>(m)
  positions[m - 1] = end
  for (let i = m - 1; i > 0; i--) positions[i - 1] = backBuf[i * n + positions[i]]

  let score = best
  score -= (n - nameStart) * 0.05
  score -= nameStart * 0.02
  if (t.slice(nameStart).startsWith(q)) score += 12
  return { score, positions }
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string, limit = 60): { item: T; positions: number[] }[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, positions: [] }))
  const out: { item: T; positions: number[]; score: number }[] = []
  for (const item of items) {
    const m = fuzzyMatch(query, key(item))
    if (m) out.push({ item, positions: m.positions, score: m.score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
