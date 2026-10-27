import { describe, expect, it } from 'vitest'
import { cleanCommitMessage, condenseDiff, lineChanges } from '../../src/shared/gitText'

describe('condenseDiff', () => {
  const file = (name: string, body: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${body}\n`
  it('keeps small diffs as they are', () => {
    const d = file('src/a.ts', '-old\n+new')
    expect(condenseDiff(d)).toBe(d)
  })
  it('summarises lock files and huge files', () => {
    const lock = file('package-lock.json', '+"a": 1\n+"b": 2\n-"c": 3')
    const big = file('src/big.ts', '+x'.repeat(3000))
    const out = condenseDiff(lock + big, 14000, 800)
    expect(out).toContain('package-lock.json: dependency lock file updated (+2 -1 lines)')
    expect(out).toContain('more characters of changes')
    expect(out.length).toBeLessThan(1200)
  })
  it('says how many files did not fit', () => {
    const many = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`, '+' + 'y'.repeat(200))).join('')
    expect(condenseDiff(many, 700)).toMatch(/\[\d+ more changed files not shown\]/)
  })
})

describe('cleanCommitMessage', () => {
  it('strips fences, labels and quotes', () => {
    expect(cleanCommitMessage('```\nAdd expiry search\n```')).toBe('Add expiry search')
    expect(cleanCommitMessage('Commit message: "Fix login redirect."')).toBe('Fix login redirect')
    expect(cleanCommitMessage('**Refactor the parser**\n\n\n\nIt was slow.')).toBe('Refactor the parser\n\nIt was slow.')
  })
})

describe('lineChanges', () => {
  it('finds added, modified and deleted lines', () => {
    const base = 'a\nb\nc\nd\ne\n'
    const now = 'a\nB\nc\nnew1\nnew2\nd\n'
    expect(lineChanges(base, now)).toEqual([
      { kind: 'modified', start: 2, end: 2 },
      { kind: 'added', start: 4, end: 5 },
      { kind: 'deleted', start: 6, end: 6 }
    ])
  })
  it('ignores line ending differences', () => {
    expect(lineChanges('a\nb\n', 'a\r\nb\r\n')).toEqual([])
  })
  it('marks a deletion at the end of the file on the last line', () => {
    expect(lineChanges('a\nb\nc\n', 'a\n')).toEqual([{ kind: 'deleted', start: 1, end: 1 }])
  })
  it('treats a whole new file as added', () => {
    expect(lineChanges('', 'x\ny\n')).toEqual([{ kind: 'added', start: 1, end: 2 }])
  })
})
