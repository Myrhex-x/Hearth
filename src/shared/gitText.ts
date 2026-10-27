import { diffLines } from 'diff'

// Text helpers for the source control features: shrinking a diff so a local
// model can read it, tidying the message it writes, and the per-line markers
// shown in the editor gutter.

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|flake\.lock|Podfile\.lock|packages\.lock\.json)$/

/** Splits a unified diff per file, summarises noise and caps the total size. */
export function condenseDiff(diff: string, maxChars = 14000, perFile = 3500): string {
  const chunks = diff.split(/(?=^diff --git )/m).filter((c) => c.trim())
  const out: string[] = []
  let total = 0
  let skipped = 0
  for (const chunk of chunks) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
    const file = header ? header[2] : 'file'
    const added = (chunk.match(/^\+(?!\+\+)/gm) ?? []).length
    const removed = (chunk.match(/^-(?!--)/gm) ?? []).length
    let text: string
    if (LOCKFILES.test(file)) text = `${file}: dependency lock file updated (+${added} -${removed} lines)\n`
    else if (/^Binary files /m.test(chunk)) text = `${file}: binary file changed\n`
    else if (chunk.length > perFile) text = chunk.slice(0, perFile) + `\n[${file}: ${chunk.length - perFile} more characters of changes, +${added} -${removed} lines in total]\n`
    else text = chunk
    if (total + text.length > maxChars) {
      skipped++
      continue
    }
    out.push(text)
    total += text.length
  }
  if (skipped) out.push(`[${skipped} more changed ${skipped === 1 ? 'file' : 'files'} not shown]\n`)
  return out.join('')
}

/** Removes what models like to wrap a commit message in. */
export function cleanCommitMessage(text: string): string {
  let t = text.replace(/\r\n/g, '\n').trim()
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  t = t.replace(/^(\*\*)?(suggested )?commit message:?(\*\*)?\s*/i, '').trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('`') && t.endsWith('`'))) t = t.slice(1, -1).trim()
  const lines = t.split('\n')
  lines[0] = lines[0].replace(/^#+\s*/, '').replace(/^\*\*(.*)\*\*$/, '$1').replace(/\.$/, '').trim()
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface LineChange {
  kind: 'added' | 'modified' | 'deleted'
  /** 1-based, inclusive, in the current text. For "deleted", the line below the removed block. */
  start: number
  end: number
}

/** Which lines of `current` differ from `base`, the way editors mark them in the gutter. */
export function lineChanges(base: string, current: string): LineChange[] {
  const a = base.replace(/\r\n/g, '\n')
  const b = current.replace(/\r\n/g, '\n')
  if (a === b) return []
  const withEol = (t: string) => (t === '' || t.endsWith('\n') ? t : t + '\n')
  const parts = diffLines(withEol(a), withEol(b))
  const changes: LineChange[] = []
  let line = 1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const count = p.count ?? p.value.split('\n').length - 1
    if (p.removed) {
      const next = parts[i + 1]
      if (next?.added) {
        const added = next.count ?? next.value.split('\n').length - 1
        changes.push({ kind: 'modified', start: line, end: line + added - 1 })
        line += added
        i++
      } else {
        changes.push({ kind: 'deleted', start: line, end: line })
      }
      continue
    }
    if (p.added) {
      changes.push({ kind: 'added', start: line, end: line + count - 1 })
      line += count
      continue
    }
    line += count
  }
  const lastLine = b.split('\n').length - (b.endsWith('\n') ? 1 : 0)
  return changes.map((c) => (c.kind === 'deleted' && c.start > lastLine ? { ...c, start: Math.max(1, lastLine), end: Math.max(1, lastLine) } : c))
}
