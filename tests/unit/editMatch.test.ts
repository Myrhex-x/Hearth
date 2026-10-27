import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/shared/editMatch'

describe('applyEdit', () => {
  const file = ['function add(a, b) {', '  return a + b', '}', '', 'function sub(a, b) {', '  return a - b', '}', ''].join('\n')

  it('replaces an exact unique match', () => {
    const r = applyEdit(file, '  return a + b', '  return a + b + 0')
    expect(r.ok && r.content).toContain('return a + b + 0')
    expect(r.ok && r.matchedBy).toBe('exact')
  })

  it('refuses an ambiguous match', () => {
    const r = applyEdit(file, '}', '};')
    expect(r).toMatchObject({ ok: false, reason: 'ambiguous', count: 2 })
  })

  it('reports text that is not in the file', () => {
    expect(applyEdit(file, 'return a * b', 'x')).toMatchObject({ ok: false, reason: 'not-found' })
  })

  it('tolerates trailing spaces from the model', () => {
    const r = applyEdit(file, 'function add(a, b) {   \n  return a + b  ', 'function add(a, b) {\n  return b + a')
    expect(r.ok && r.content).toContain('return b + a')
    expect(r.ok && r.matchedBy).toBe('trailing-space')
  })

  it('matches when the model lost the indentation, and re-indents the replacement', () => {
    const nested = ['class A {', '    run() {', '        go()', '        stop()', '    }', '}'].join('\n')
    const r = applyEdit(nested, 'go()\nstop()', 'go()\nwait()\nstop()')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.matchedBy).toBe('indentation')
      expect(r.content).toBe(['class A {', '    run() {', '        go()', '        wait()', '        stop()', '    }', '}'].join('\n'))
    }
  })

  it('keeps Windows line endings', () => {
    const crlf = 'a\r\nb\r\nc\r\n'
    const r = applyEdit(crlf, 'b', 'B\nB2')
    expect(r.ok && r.content).toBe('a\r\nB\r\nB2\r\nc\r\n')
  })

  it('matches LF search text against a CRLF file', () => {
    const crlf = 'one\r\ntwo\r\nthree\r\n'
    const r = applyEdit(crlf, 'one\ntwo', 'uno\ndos')
    expect(r.ok && r.content).toBe('uno\r\ndos\r\nthree\r\n')
  })

  it('fills an empty file when old_text is empty', () => {
    const r = applyEdit('', '', 'hello')
    expect(r.ok && r.content).toBe('hello')
  })

  it('rejects an empty old_text on a non-empty file', () => {
    expect(applyEdit(file, '  ', 'x')).toMatchObject({ ok: false, reason: 'empty' })
  })
})

describe('applyEdit ambiguity details', () => {
  it('lists the lines where an ambiguous snippet appears', () => {
    const r = applyEdit('a\n}\nb\n}\n', '}', 'x')
    expect(r).toMatchObject({ ok: false, reason: 'ambiguous', lines: [2, 4] })
  })
})
