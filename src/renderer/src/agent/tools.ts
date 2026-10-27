import { applyEdit, editFailureMessage } from '../../../shared/editMatch'
import type { DirEntry, ToolCall, ToolSpec } from '../../../shared/types'
import { api, uid } from '../api'
import { normalizeRel } from '../lib/paths'
import { openText, writeFileContent } from '../state/editor'
import { useWorkspace } from '../state/workspace'
import { settingsNow } from '../state/settings'
import { computeDiff } from './diff'
import type { ToolStep } from './types'

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'list_files',
    description: 'List the files and folders of the project, or of one folder in it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder relative to the project root. Leave empty for the root.' },
        depth: { type: 'integer', description: 'How many levels deep to list, 1 to 4. Default 2.' }
      }
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file from the project. Long files are cut: use start_line and end_line to read other parts.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root, like src/main.ts' },
        start_line: { type: 'integer', description: 'First line to read (1-based). Optional.' },
        end_line: { type: 'integer', description: 'Last line to read. Optional.' }
      },
      required: ['path']
    }
  },
  {
    name: 'search',
    description: 'Search the text of every project file. Returns matching lines as path:line: text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to look for.' },
        regex: { type: 'boolean', description: 'Treat the query as a regular expression.' },
        path: { type: 'string', description: 'Only search inside this folder. Optional.' }
      },
      required: ['query']
    }
  },
  {
    name: 'edit_file',
    description:
      'Change part of an existing file: old_text is replaced by new_text. old_text must be copied exactly from the file and match a single place, so include 2 or 3 unchanged lines around the change. Use an empty new_text to delete. To add code at the end of the file, leave old_text empty.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        old_text: { type: 'string', description: 'The exact current text to replace. Empty to add new_text at the end of the file.' },
        new_text: { type: 'string', description: 'The text to put in its place.' }
      },
      required: ['path', 'old_text', 'new_text']
    }
  },
  {
    name: 'write_file',
    description: 'Create a new file. Missing folders are created. On an existing file it replaces everything, so prefer edit_file for changes and additions.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        content: { type: 'string', description: 'The complete file content.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'delete_file',
    description: 'Move a file to the trash.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the project root.' } },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the project folder and get its output and exit code. The user approves each command first. Use commands that finish on their own.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run.' },
        cwd: { type: 'string', description: 'Folder to run it in, relative to the project root. Optional.' }
      },
      required: ['command']
    }
  }
]

export const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'search'])
export const TOOL_NAMES = TOOL_SPECS.map((t) => t.name)

export interface Decision {
  approved: boolean
  feedback?: string
}

export interface ToolContext {
  /** Files the model has seen in full or in part during this turn. */
  seen: Set<string>
  update(patch: Partial<ToolStep>): void
  requestApproval(): Promise<Decision>
  isStopped(): boolean
  recordChange(path: string, before: string | null, after: string | null): void
  setRunning(requestId: string | null): void
}

const READ_LIMIT_LINES = 400
const READ_LIMIT_CHARS = 28000

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
}

function int(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? Math.floor(n) : undefined
}

/** Model-supplied path, cleaned and made relative to the project when it points inside it. */
function pathArg(v: unknown): string {
  const raw = str(v).trim().replace(/^["'`]|["'`]$/g, '')
  if (/^([a-zA-Z]:)?[\\/]/.test(raw)) {
    const rel = projectRelative(raw)
    return rel === raw ? raw : normalizeRel(rel)
  }
  return normalizeRel(raw)
}

/** The path with its real casing, so it matches the open tab on macOS and Windows. */
async function filePath(v: unknown): Promise<string> {
  const p = pathArg(v)
  if (!p) return p
  try {
    return await api.workspace.canonical(p)
  } catch {
    return p
  }
}

async function currentText(path: string): Promise<{ text: string; exists: boolean; problem?: string }> {
  const open = openText(path)
  if (open !== null) return { text: open, exists: true }
  const kind = await api.workspace.exists(path)
  if (kind === null) return { text: '', exists: false }
  if (kind === 'dir') return { text: '', exists: true, problem: `${path} is a folder, not a file.` }
  const file = await api.workspace.readFile(path)
  if (file.binary) return { text: '', exists: true, problem: `${path} is a binary file and cannot be read as text.` }
  if (file.tooLarge) return { text: '', exists: true, problem: `${path} is too large to read (${Math.round(file.size / 1024)} KB).` }
  return { text: file.content, exists: true }
}

export function describeCall(call: ToolCall): Pick<ToolStep, 'title' | 'path' | 'command'> {
  const a = call.arguments
  const path = pathArg(a.path)
  switch (call.name) {
    case 'list_files':
      return { title: path ? `Listing ${path}` : 'Listing the project', path: path || undefined }
    case 'read_file':
      return { title: `Reading ${path}`, path }
    case 'search':
      return { title: `Searching for "${str(a.query).slice(0, 60)}"` }
    case 'edit_file':
      return { title: `Editing ${path}`, path }
    case 'write_file':
      return { title: `Writing ${path}`, path }
    case 'delete_file':
      return { title: `Deleting ${path}`, path }
    case 'run_command':
      return { title: 'Running a command', command: str(a.command) }
    default:
      return { title: `Calling ${call.name}` }
  }
}

async function listFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const start = pathArg(args.path)
  const depth = Math.min(4, Math.max(1, int(args.depth) ?? 2))
  const lines: string[] = []
  let count = 0
  const walk = async (dir: string, level: number) => {
    let entries: DirEntry[]
    try {
      entries = await api.workspace.listDir(dir)
    } catch (err) {
      if (level === 0) throw err
      return
    }
    for (const e of entries) {
      if (count >= 300) return
      count++
      const indent = '  '.repeat(level)
      if (e.kind === 'dir') {
        lines.push(`${indent}${e.name}/${e.ignored ? '  (generated or ignored, not listed)' : ''}`)
        if (!e.ignored && level + 1 < depth) await walk(e.path, level + 1)
      } else lines.push(`${indent}${e.name}`)
    }
  }
  await walk(start, 0)
  ctx.update({ title: start ? `Listed ${start}` : 'Listed the project', detail: `${count} entries` })
  if (!lines.length) return `${start || 'The project'} is empty.`
  return `${start || 'Project root'}:\n${lines.join('\n')}${count >= 300 ? '\n[list cut at 300 entries]' : ''}`
}

async function readFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = await filePath(args.path)
  if (!path) throw new Error('read_file needs a path.')
  const cur = await currentText(path)
  if (!cur.exists) throw new Error(`${path} does not exist. Use list_files or search to find the right path.`)
  if (cur.problem) throw new Error(cur.problem)
  const lines = cur.text.split(/\r?\n/)
  const total = lines.length
  let from = Math.max(1, int(args.start_line) ?? 1)
  if (from > total) from = Math.max(1, total - READ_LIMIT_LINES + 1)
  let to = Math.min(total, int(args.end_line) ?? from + READ_LIMIT_LINES - 1)
  if (to < from) to = Math.min(total, from + READ_LIMIT_LINES - 1)
  let slice = lines.slice(from - 1, to)
  let chars = 0
  let cut = 0
  for (let i = 0; i < slice.length; i++) {
    chars += slice[i].length + 1
    if (chars > READ_LIMIT_CHARS) {
      cut = i
      break
    }
  }
  if (cut) {
    slice = slice.slice(0, cut)
    to = from + cut - 1
  }
  const partial = from > 1 || to < total
  ctx.seen.add(path)
  ctx.update({ title: `Read ${path}`, path, detail: partial ? `lines ${from} to ${to} of ${total}` : `${total} lines` })
  const header = partial ? `${path} (lines ${from}-${to} of ${total}):` : `${path} (${total} lines):`
  const footer = to < total ? `\n[${total - to} more lines. Call read_file with start_line=${to + 1} to continue.]` : ''
  return `${header}\n${slice.join('\n')}${footer}`
}

async function search(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = str(args.query)
  if (!query) throw new Error('search needs a query.')
  const res = await api.workspace.search({ query, regex: !!args.regex, under: pathArg(args.path) || undefined, maxResults: 80 })
  if (res.error) throw new Error(`Invalid search: ${res.error}`)
  ctx.update({ title: `Searched for "${query.slice(0, 60)}"`, detail: res.matches.length ? `${res.matches.length}${res.truncated ? '+' : ''} results` : 'no results' })
  if (!res.matches.length) return `No matches for "${query}".`
  const lines = res.matches.map((m) => `${m.path}:${m.line}: ${m.text.trim().slice(0, 200)}`)
  return lines.join('\n') + (res.truncated ? '\n[more matches not shown; narrow the search]' : '')
}

async function gateEdit(ctx: ToolContext, always = false): Promise<Decision> {
  if (!always && settingsNow().agent.autoApplyEdits) return { approved: true }
  return ctx.requestApproval()
}

function declined(d: Decision): string {
  return `The user declined this change.${d.feedback ? ` Their note: ${d.feedback}` : ''}`
}

async function editFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = await filePath(args.path)
  if (!path) throw new Error('edit_file needs a path.')
  const cur = await currentText(path)
  if (!cur.exists) throw new Error(`${path} does not exist. To create it, use write_file.`)
  if (cur.problem) throw new Error(cur.problem)
  const result = applyEdit(cur.text, str(args.old_text), str(args.new_text))
  if (!result.ok) throw new Error(editFailureMessage(path, result))
  const diff = computeDiff(cur.text, result.content)
  if (!diff.added && !diff.removed) {
    ctx.update({ title: `No change to ${path}`, path })
    return `old_text and new_text are the same; ${path} was not changed.`
  }
  ctx.update({ title: `Edit ${path}`, path, diff })
  const d = await gateEdit(ctx)
  if (!d.approved) return declined(d)
  await writeFileContent(path, result.content)
  ctx.recordChange(path, cur.text, result.content)
  ctx.seen.add(path)
  ctx.update({ title: `Edited ${path}`, detail: undefined })
  if (result.matchedBy === 'append') return `Added the code at the end of ${path}, lines ${result.startLine}-${result.endLine}.`
  const note = result.matchedBy === 'exact' ? '' : ' (matched after ignoring whitespace differences)'
  return `Edited ${path}, now lines ${result.startLine}-${result.endLine}${note}.`
}

async function writeFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = await filePath(args.path)
  if (!path) throw new Error('write_file needs a path.')
  const content = str(args.content)
  const cur = await currentText(path)
  if (cur.problem) throw new Error(cur.problem)
  const before = cur.exists ? cur.text : null
  // Small models like to "rewrite" a file they never looked at, losing its content.
  if (before !== null && before.trim() && !ctx.seen.has(path)) {
    throw new Error(`${path} already exists and you have not read it. Call read_file first, then use edit_file to change or add to it (write_file replaces the whole file).`)
  }
  if (before !== null && before.replace(/\r\n/g, '\n') === content.replace(/\r\n/g, '\n')) {
    ctx.update({ title: `No change to ${path}`, path })
    return `${path} already has this content.`
  }
  // Keep Windows line endings in files that use them.
  const finalContent = before !== null && /\r\n/.test(before) ? content.replace(/\r?\n/g, '\r\n') : content
  ctx.update({ title: before === null ? `Create ${path}` : `Rewrite ${path}`, path, diff: computeDiff(before ?? '', finalContent) })
  const d = await gateEdit(ctx)
  if (!d.approved) return declined(d)
  await writeFileContent(path, finalContent)
  ctx.recordChange(path, before, finalContent)
  ctx.seen.add(path)
  ctx.update({ title: before === null ? `Created ${path}` : `Rewrote ${path}` })
  return before === null ? `Created ${path}.` : `Replaced the content of ${path}.`
}

async function deleteFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = await filePath(args.path)
  if (!path) throw new Error('delete_file needs a path.')
  const cur = await currentText(path)
  if (!cur.exists) throw new Error(`${path} does not exist.`)
  if (cur.problem) throw new Error(cur.problem)
  ctx.update({ title: `Delete ${path}`, path, diff: computeDiff(cur.text, '') })
  const d = await gateEdit(ctx, true)
  if (!d.approved) return declined(d)
  await api.workspace.trash(path)
  ctx.recordChange(path, cur.text, null)
  ctx.update({ title: `Deleted ${path}` })
  return `Moved ${path} to the trash.`
}

function clip(output: string, max = 6000): string {
  if (output.length <= max) return output
  const head = output.slice(0, 1500)
  const tail = output.slice(output.length - (max - 1600))
  return `${head}\n[... ${output.length - max} characters cut ...]\n${tail}`
}

function projectRelative(p: string): string {
  const root = useWorkspace.getState().info?.root
  if (!p || !root) return p
  const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const r = norm(root)
  const n = norm(p)
  if (n === r) return ''
  if (n.startsWith(r + '/')) return p.replace(/\\/g, '/').slice(r.length + 1)
  return p
}

async function runCommand(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const command = str(args.command).trim()
  if (!command) throw new Error('run_command needs a command.')
  const cwd = projectRelative(pathArg(args.cwd)).replace(/^\.\/?$/, '')
  ctx.update({ title: 'Run command', command, detail: cwd ? `in ${cwd}` : undefined })
  if (!settingsNow().agent.autoRunCommands) {
    const d = await ctx.requestApproval()
    if (!d.approved) return `The user declined to run this command.${d.feedback ? ` Their note: ${d.feedback}` : ''}`
  }
  ctx.update({ title: 'Running', status: 'running' })
  const requestId = uid('exec')
  let output = ''
  let pending = false
  const off = api.exec.onOutput(requestId, (chunk) => {
    output += chunk
    if (output.length > 200_000) output = output.slice(-100_000)
    if (!pending) {
      pending = true
      setTimeout(() => {
        pending = false
        ctx.update({ output })
      }, 80)
    }
  })
  ctx.setRunning(requestId)
  try {
    const res = await api.exec.run(requestId, command, cwd || undefined)
    ctx.update({ output: res.output, exitCode: res.exitCode, title: res.aborted ? 'Stopped' : 'Ran' })
    let summary = `Exit code: ${res.exitCode ?? 'none'}`
    if (res.timedOut) summary += ' (stopped after 5 minutes)'
    if (res.aborted) summary += ' (stopped by the user)'
    const text = res.output.trim()
    return `${summary}\n${text ? clip(text) : '(no output)'}`
  } finally {
    off()
    ctx.setRunning(null)
  }
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const args = call.arguments ?? {}
  if (typeof args._raw === 'string') {
    throw new Error(`The arguments for ${call.name} were not valid JSON. Send them again as a JSON object.`)
  }
  switch (call.name) {
    case 'list_files':
      return listFiles(args, ctx)
    case 'read_file':
      return readFile(args, ctx)
    case 'search':
      return search(args, ctx)
    case 'edit_file':
      return editFile(args, ctx)
    case 'write_file':
      return writeFile(args, ctx)
    case 'delete_file':
      return deleteFile(args, ctx)
    case 'run_command':
      return runCommand(args, ctx)
    default:
      throw new Error(`There is no tool called ${call.name}. Available tools: ${TOOL_NAMES.join(', ')}.`)
  }
}
