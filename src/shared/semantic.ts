// Pure helpers for search by meaning: cutting files into pieces worth
// embedding, the prompts each embedding model expects, and ranking.

export interface Chunk {
  /** 1-based, inclusive. */
  start: number
  end: number
  text: string
}

const TARGET_LINES = 48
const MAX_LINES = 72
const MAX_CHARS = 2400
const OVERLAP = 6

/** Files that are generated or too noisy to be worth searching by meaning. */
export function worthIndexing(path: string, text: string): boolean {
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/.test(path)) return false
  if (/\.(min\.(js|css)|map|svg|lock|snap|ico|png|jpe?g|gif|webp|pdf|woff2?|ttf|otf|zip|gz)$/i.test(path)) return false
  if (!text.trim()) return false
  const lines = text.split('\n')
  // Minified or data dumps: very long average lines.
  if (text.length / Math.max(1, lines.length) > 300) return false
  return true
}

/**
 * Splits a file into overlapping pieces of about 50 lines, preferring to end
 * a piece on a blank line or where indentation returns to the left margin, so
 * functions and classes tend to stay whole.
 */
export function chunkText(text: string): Chunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const chunks: Chunk[] = []
  let start = 0
  while (start < lines.length) {
    let end = Math.min(lines.length, start + TARGET_LINES)
    if (end < lines.length) {
      // Look a little further for a natural break.
      let best = -1
      for (let i = end; i < Math.min(lines.length, start + MAX_LINES); i++) {
        const line = lines[i]
        if (line.trim() === '' || /^\S/.test(line)) {
          best = i
          if (line.trim() === '') break
        }
      }
      if (best > start) end = best
    }
    // Respect the character budget.
    let chars = 0
    for (let i = start; i < end; i++) {
      chars += lines[i].length + 1
      if (chars > MAX_CHARS && i > start) {
        end = i
        break
      }
    }
    const body = lines.slice(start, end).join('\n')
    if (body.trim()) chunks.push({ start: start + 1, end, text: body })
    if (end >= lines.length) break
    start = Math.max(start + 1, end - OVERLAP)
  }
  return chunks
}

/** Some embedding models are trained with task prefixes; using them matters for quality. */
export function queryText(model: string, query: string): string {
  const m = model.toLowerCase()
  if (m.includes('nomic-embed')) return `search_query: ${query}`
  if (m.includes('qwen3-embedding')) return `Instruct: Given a question about a codebase, retrieve the code that answers it\nQuery: ${query}`
  if (m.includes('embeddinggemma')) return `task: code retrieval | query: ${query}`
  if (m.includes('mxbai-embed') || m.includes('bge-')) return `Represent this sentence for searching relevant passages: ${query}`
  if (m.includes('snowflake-arctic-embed')) return `Represent this sentence for searching relevant passages: ${query}`
  return query
}

export function documentText(model: string, path: string, chunk: Chunk): string {
  const m = model.toLowerCase()
  const body = `${path} (lines ${chunk.start}-${chunk.end})\n${chunk.text}`
  if (m.includes('nomic-embed')) return `search_document: ${body}`
  if (m.includes('embeddinggemma')) return `title: ${path} | text: ${chunk.text}`
  return body
}

// Words too common in questions to say anything about the code.
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'where', 'what', 'when', 'which', 'how', 'does', 'are', 'into', 'its', 'can', 'there', 'here', 'some', 'about', 'code'])

/** Four-letter word stems, with camelCase and snake_case split, so "closing" finds handleCloseRequest. */
function stems(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (!STOP.has(word)) out.add(word.slice(0, 4))
  }
  return out
}

const MODIFIERS = '(?:(?:export|default|async|public|private|protected|static|override|abstract|pub(?:\\([^)]*\\))?)\\s+)*'
const DEFINITION = new RegExp(`^\\s*${MODIFIERS}(?:function\\b|class\\b|interface\\b|enum\\b|struct\\b|trait\\b|impl\\b|def\\b|fn\\b|func\\b|type\\s+[\\w$]+\\s*=)`)
// Variables count only at the top level; inside a function they are just lines of it.
const TOP_LEVEL_VARIABLE = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=/
// Methods like `async refresh() {`, but not `if (ready) {`.
const METHOD = new RegExp(`^\\s*${MODIFIERS}(?!(?:if|for|while|switch|catch|with|return|function)\\b)[A-Za-z_$][\\w$]*\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{\\s*$`)
const LEAD_IN = /^\s*(?:\/\/|\/\*|\*|#|--|@)/
const CLOSING = /^\s*[}\])]+[;,)]*\s*$/
const SCORED_LINES = 10

/**
 * Which line of a found piece to show first. A piece often starts in the
 * middle of the previous function, so prefer the definition (with the comment
 * above it) whose next few lines share the most words with the question.
 */
export function previewLine(text: string, query: string, size = 6): number {
  const lines = text.split('\n')
  const wanted = stems(query)
  const indent = lines.map((l) => /^\s*/.exec(l)![0].length)
  const isDef = lines.map((l) => DEFINITION.test(l) || TOP_LEVEL_VARIABLE.test(l) || METHOD.test(l))
  // Where each line's preview would begin: a definition takes the comment above it along.
  const begin = lines.map((_, i) => {
    let s = i
    while (isDef[i] && s > 0 && i - s < 4 && LEAD_IN.test(lines[s - 1])) s--
    return s
  })
  const first = lines.findIndex((l) => l.trim() && !CLOSING.test(l))
  let best = Math.max(0, first)
  let bestKey: number[] | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!isDef[i] && i !== first) continue
    // Score only this definition's own lines, up to where the next one starts.
    let end = Math.min(lines.length, begin[i] + Math.max(size, SCORED_LINES))
    for (let j = i + 1; j < end; j++) {
      if (isDef[j] && (!isDef[i] || indent[j] <= indent[i])) {
        end = begin[j]
        break
      }
    }
    const words = stems(lines.slice(begin[i], end).join(' '))
    let matches = 0
    for (const w of wanted) if (words.has(w)) matches++
    // More shared words, then definitions, then the outermost; ties keep the earliest.
    const key = [matches, isDef[i] ? 1 : 0, -indent[i]]
    if (!bestKey || ranksAbove(key, bestKey)) {
      best = begin[i]
      bestKey = key
    }
  }
  return best
}

function ranksAbove(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]
  return false
}

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length)
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum) || 1
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

export interface Ranked {
  index: number
  score: number
}

/**
 * How far above a typical piece of the project a result has to score to count
 * as related. Measured with qwen3-embedding on this repository: questions about
 * the code put their answers 0.35 or more above the average piece; greetings
 * and off-topic questions stay under 0.18.
 */
export const STANDS_OUT = 0.2

/**
 * Top-k by cosine similarity, for vectors stored back to back and already
 * normalized. Also returns the average score of every vector considered, the
 * baseline that tells a real match from the best of a bad lot.
 */
export function topK(query: Float32Array, vectors: Float32Array, dims: number, k: number, keep?: (index: number) => boolean): { hits: Ranked[]; mean: number } {
  const count = Math.floor(vectors.length / dims)
  const best: Ranked[] = []
  let sum = 0
  let considered = 0
  for (let i = 0; i < count; i++) {
    if (keep && !keep(i)) continue
    let dot = 0
    const base = i * dims
    for (let d = 0; d < dims; d++) dot += query[d] * vectors[base + d]
    sum += dot
    considered++
    if (best.length < k) {
      best.push({ index: i, score: dot })
      best.sort((a, b) => b.score - a.score)
    } else if (dot > best[best.length - 1].score) {
      best[best.length - 1] = { index: i, score: dot }
      best.sort((a, b) => b.score - a.score)
    }
  }
  return { hits: best, mean: considered ? sum / considered : 0 }
}
