import { structuredPatch } from 'diff'
import type { DiffInfo } from './types'

const MAX_LINES = 400

export function computeDiff(before: string, after: string): DiffInfo {
  const a = before.replace(/\r\n/g, '\n')
  const b = after.replace(/\r\n/g, '\n')
  const patch = structuredPatch('a', 'b', a, b, '', '', { context: 2 })
  let added = 0
  let removed = 0
  let budget = MAX_LINES
  let truncated = false
  const hunks = patch.hunks.map((h) => {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
    const lines = h.lines.filter((l) => !l.startsWith('\\')).slice(0, Math.max(0, budget))
    if (lines.length < h.lines.length) truncated = true
    budget -= lines.length
    return { oldStart: h.oldStart, newStart: h.newStart, lines }
  })
  return { added, removed, hunks: hunks.filter((h) => h.lines.length), truncated }
}
