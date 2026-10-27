// Small models asked to add a test sometimes "rewrite" the test file with
// only the new test, losing every other one. Counting what a rewrite drops
// lets the agent stop it once and point to edit_file.

/** How many of the file's non-blank lines the new content no longer has. */
export function linesDropped(before: string, after: string): { total: number; dropped: number } {
  const remaining = new Map<string, number>()
  for (const line of after.split(/\r?\n/)) {
    const key = line.trim()
    if (key) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  let total = 0
  let dropped = 0
  for (const line of before.split(/\r?\n/)) {
    const key = line.trim()
    if (!key) continue
    total++
    const left = remaining.get(key) ?? 0
    if (left > 0) remaining.set(key, left - 1)
    else dropped++
  }
  return { total, dropped }
}

/** A rewrite that loses more than half of a file of some size. */
export function losesMostOfFile(before: string, after: string): boolean {
  const { total, dropped } = linesDropped(before, after)
  return total >= 8 && dropped > total / 2
}
