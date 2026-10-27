// Applies a search-and-replace edit proposed by a model. Local models often get
// whitespace slightly wrong (tabs vs spaces, trailing spaces, a missing indent
// level), so after an exact match fails we retry line by line while ignoring
// indentation, then re-indent the replacement to match the file.

export type EditResult =
  | { ok: true; content: string; matchedBy: 'exact' | 'trailing-space' | 'indentation'; startLine: number; endLine: number }
  | { ok: false; reason: 'empty' | 'not-found' | 'ambiguous'; count?: number; lines?: number[] }

function detectEol(text: string): '\r\n' | '\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}

function countOccurrences(haystack: string, needle: string): number[] {
  const at: number[] = []
  let i = haystack.indexOf(needle)
  while (i >= 0) {
    at.push(i)
    i = haystack.indexOf(needle, i + Math.max(1, needle.length))
  }
  return at
}

function lineOf(text: string, offset: number): number {
  let n = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function trimBlankEdges(lines: string[]): string[] {
  let s = 0
  let e = lines.length
  while (s < e && lines[s].trim() === '') s++
  while (e > s && lines[e - 1].trim() === '') e--
  return lines.slice(s, e)
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0]
}

function findLineMatches(fileLines: string[], needle: string[], compare: (a: string, b: string) => boolean): number[] {
  const hits: number[] = []
  if (!needle.length) return hits
  outer: for (let i = 0; i + needle.length <= fileLines.length; i++) {
    for (let k = 0; k < needle.length; k++) if (!compare(fileLines[i + k], needle[k])) continue outer
    hits.push(i)
  }
  return hits
}

/** Shifts the indentation of `lines` from the model's base indent to the file's. */
function reindent(lines: string[], fromIndent: string, toIndent: string): string[] {
  if (fromIndent === toIndent) return lines
  return lines.map((line) => {
    if (line.trim() === '') return line
    if (line.startsWith(fromIndent)) return toIndent + line.slice(fromIndent.length)
    const lead = leadingWhitespace(line)
    if (fromIndent.startsWith(lead)) return toIndent + line.slice(lead.length)
    return line
  })
}

export function applyEdit(original: string, oldText: string, newText: string): EditResult {
  const eol = detectEol(original)
  const file = original.replace(/\r\n/g, '\n')
  const search = (oldText ?? '').replace(/\r\n/g, '\n')
  const replacement = (newText ?? '').replace(/\r\n/g, '\n')
  const finish = (content: string, matchedBy: 'exact' | 'trailing-space' | 'indentation', startLine: number, endLine: number): EditResult => ({
    ok: true,
    content: eol === '\r\n' ? content.replace(/\n/g, '\r\n') : content,
    matchedBy,
    startLine,
    endLine
  })

  if (search.trim() === '') {
    if (file.trim() === '') return finish(replacement, 'exact', 1, replacement.split('\n').length)
    return { ok: false, reason: 'empty' }
  }

  const exact = countOccurrences(file, search)
  if (exact.length === 1) {
    const at = exact[0]
    const content = file.slice(0, at) + replacement + file.slice(at + search.length)
    const startLine = lineOf(file, at)
    return finish(content, 'exact', startLine, startLine + replacement.split('\n').length - 1)
  }
  if (exact.length > 1) return { ok: false, reason: 'ambiguous', count: exact.length, lines: exact.map((at) => lineOf(file, at)) }

  const fileLines = file.split('\n')
  const needle = trimBlankEdges(search.split('\n'))
  const replLines = trimBlankEdges(replacement.split('\n'))
  if (!needle.length) return { ok: false, reason: 'not-found' }

  const passes: { by: 'trailing-space' | 'indentation'; cmp: (a: string, b: string) => boolean }[] = [
    { by: 'trailing-space', cmp: (a, b) => a.trimEnd() === b.trimEnd() },
    { by: 'indentation', cmp: (a, b) => a.trim() === b.trim() }
  ]
  for (const pass of passes) {
    const hits = findLineMatches(fileLines, needle, pass.cmp)
    if (hits.length > 1) return { ok: false, reason: 'ambiguous', count: hits.length, lines: hits.map((h) => h + 1) }
    if (hits.length === 1) {
      const start = hits[0]
      const firstFileLine = fileLines.slice(start, start + needle.length).find((l) => l.trim() !== '') ?? ''
      const firstNeedleLine = needle.find((l) => l.trim() !== '') ?? ''
      const adjusted =
        pass.by === 'indentation' ? reindent(replLines, leadingWhitespace(firstNeedleLine), leadingWhitespace(firstFileLine)) : replLines
      const next = [...fileLines.slice(0, start), ...adjusted, ...fileLines.slice(start + needle.length)]
      return finish(next.join('\n'), pass.by, start + 1, start + Math.max(1, adjusted.length))
    }
  }
  return { ok: false, reason: 'not-found' }
}

/** A short, model-facing explanation of why an edit failed. */
export function editFailureMessage(path: string, r: Extract<EditResult, { ok: false }>): string {
  if (r.reason === 'empty') return `old_text was empty, but ${path} is not empty. Copy the exact lines to replace into old_text, or use write_file to replace the whole file.`
  if (r.reason === 'ambiguous') {
    const where = r.lines?.length ? ` (lines ${r.lines.slice(0, 8).join(', ')}${r.lines.length > 8 ? ', ...' : ''})` : ''
    return `old_text matches ${r.count} places in ${path}${where}. Include the distinctive lines around the change (a function name, for example) so it matches exactly one place.`
  }
  return `old_text was not found in ${path}. Call read_file to see the current text, then copy the lines exactly (including indentation).`
}
