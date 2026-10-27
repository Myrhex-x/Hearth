import { describe, expect, it } from 'vitest'
import { STANDS_OUT, chunkText, documentText, normalize, previewLine, queryText, topK, worthIndexing } from '../../src/shared/semantic'

describe('chunkText', () => {
  it('keeps a small file in one piece', () => {
    expect(chunkText('a\nb\nc\n')).toEqual([{ start: 1, end: 3, text: 'a\nb\nc' }])
  })

  it('covers a long file with overlapping pieces and ends them at natural breaks', () => {
    const fn = (n: number) => [`function f${n}() {`, ...Array.from({ length: 18 }, (_, i) => `  step(${n}, ${i})`), '}', ''].join('\n')
    const text = Array.from({ length: 10 }, (_, i) => fn(i)).join('\n')
    const chunks = chunkText(text)
    const total = text.split('\n').length - 1
    expect(chunks[0].start).toBe(1)
    expect(chunks[chunks.length - 1].end).toBe(total)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeLessThanOrEqual(chunks[i - 1].end + 1)
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start)
    }
    // Pieces end on a blank line or at column 0, not in the middle of a function.
    for (const c of chunks.slice(0, -1)) {
      const last = text.split('\n')[c.end]
      expect(last === '' || /^\S/.test(last)).toBe(true)
    }
  })

  it('splits huge lines by characters', () => {
    const text = Array.from({ length: 40 }, () => 'x'.repeat(200)).join('\n')
    for (const c of chunkText(text)) expect(c.text.length).toBeLessThanOrEqual(2400 + 200)
  })
})

describe('worthIndexing', () => {
  it('skips lock files, minified code and binaries', () => {
    expect(worthIndexing('package-lock.json', '{}')).toBe(false)
    expect(worthIndexing('dist/app.min.js', 'x')).toBe(false)
    expect(worthIndexing('data.json', 'y'.repeat(5000))).toBe(false)
    expect(worthIndexing('src/a.ts', 'export const a = 1\n')).toBe(true)
  })
})

describe('prompts', () => {
  it('uses the prefixes each model was trained with', () => {
    expect(queryText('nomic-embed-text:latest', 'hash passwords')).toBe('search_query: hash passwords')
    expect(queryText('qwen3-embedding:0.6b', 'q')).toMatch(/^Instruct: .*\nQuery: q$/)
    expect(queryText('some-model', 'q')).toBe('q')
    expect(documentText('nomic-embed-text', 'a.ts', { start: 1, end: 2, text: 'x' })).toBe('search_document: a.ts (lines 1-2)\nx')
  })
})

describe('topK', () => {
  it('ranks by cosine similarity', () => {
    const dims = 3
    const vectors = new Float32Array([...normalize([1, 0, 0]), ...normalize([0, 1, 0]), ...normalize([1, 1, 0])])
    const q = normalize([1, 0.1, 0])
    const ranked = topK(q, vectors, dims, 2)
    expect(ranked.hits.map((r) => r.index)).toEqual([0, 2])
    expect(topK(q, vectors, dims, 3, (i) => i !== 0).hits.map((r) => r.index)).toEqual([2, 1])
  })

  it('reports the average score, so a match can be told from the best of a bad lot', () => {
    const dims = 2
    const vectors = new Float32Array([...normalize([1, 0]), ...normalize([0, 1]), ...normalize([0, 1]), ...normalize([0, 1])])
    const { hits, mean } = topK(normalize([1, 0]), vectors, dims, 1)
    expect(mean).toBeCloseTo(0.25)
    expect(hits[0].score - mean).toBeGreaterThan(STANDS_OUT)
    // Kept vectors only: three identical pieces, none stands out.
    const flat = topK(normalize([0, 1]), vectors, dims, 1, (i) => i > 0)
    expect(flat.hits[0].score - flat.mean).toBeCloseTo(0)
  })
})

describe('previewLine', () => {
  it('skips the end of the previous function to the definition that matches', () => {
    const text = [
      '    await apply(info)',
      '  } catch (err) {',
      '    toast(`Could not open the folder`)',
      '  }',
      '}',
      '',
      '// Asks before closing a window that has unsaved files.',
      'export async function handleCloseRequest() {',
      '  const unsaved = tabs.filter((t) => t.dirty)',
      '  if (unsaved.length) return ask(unsaved)',
      '}'
    ].join('\n')
    expect(previewLine(text, 'keep the window from closing with unsaved files')).toBe(6)
  })

  it('prefers the definition that shares words with the question', () => {
    const text = [
      'export function createPantry() {',
      '  return { items: [] }',
      '}',
      '',
      'export function removeItem(pantry, name) {',
      '  const index = pantry.items.findIndex((item) => item.name === name)',
      '}'
    ].join('\n')
    expect(previewLine(text, 'how do I remove an item')).toBe(4)
    expect(previewLine(text, 'nothing in common')).toBe(0)
  })

  it('does not take control flow for a definition', () => {
    expect(previewLine(['  if (ready) {', '    start()', '  }', 'function start() {', '}'].join('\n'), 'qqq')).toBe(3)
  })

  it('falls back to the first line with content', () => {
    expect(previewLine('}\n\nSome prose about the pantry.\nMore prose.', 'pantry')).toBe(2)
  })
})
