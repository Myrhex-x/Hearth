import { describe, expect, it } from 'vitest'
import { linesDropped, losesMostOfFile } from '../../src/shared/rewrite'

const tests = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { addItem, createPantry } from '../src/pantry.js'",
  '',
  "test('adds items', () => {",
  '  const pantry = createPantry()',
  "  addItem(pantry, { name: 'rice' })",
  '  assert.equal(pantry.items.length, 1)',
  '})',
  '',
  "test('starts empty', () => {",
  '  assert.equal(createPantry().items.length, 0)',
  '})'
].join('\n')

describe('rewrites', () => {
  it('lets a file grow', () => {
    const grown = tests + "\n\ntest('counts items', () => {\n  assert.equal(countItems(createPantry()), 0)\n})\n"
    expect(linesDropped(tests, grown).dropped).toBe(0)
    expect(losesMostOfFile(tests, grown)).toBe(false)
  })

  it('stops a rewrite that keeps only the new test', () => {
    const lost = "const { countItems } = require('./pantry');\n\ntest('counts items', () => {\n  expect(countItems({ items: [] })).toBe(0);\n});\n"
    expect(linesDropped(tests, lost)).toEqual({ total: 11, dropped: 11 })
    expect(losesMostOfFile(tests, lost)).toBe(true)
  })

  it('leaves small files and real edits alone', () => {
    expect(losesMostOfFile('a\nb\nc', 'x\ny\nz')).toBe(false)
    const edited = tests.replace("name: 'rice'", "name: 'oats'").replace('assert.equal(createPantry().items.length, 0)', 'assert.deepEqual(createPantry().items, [])')
    expect(losesMostOfFile(tests, edited)).toBe(false)
  })
})
