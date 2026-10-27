import type { AppInfo, DirEntry } from '../../../shared/types'
import { api } from '../api'
import { activeTab, editorHost } from '../state/editor'
import { useWorkspace } from '../state/workspace'

let appInfo: AppInfo | null = null
export async function getAppInfo(): Promise<AppInfo> {
  if (!appInfo) appInfo = await api.app.info()
  return appInfo
}

const RULE_FILES = ['AGENTS.md', '.hearth/rules.md', '.cursorrules', 'CLAUDE.md']

async function projectRules(): Promise<string> {
  const parts: string[] = []
  for (const f of RULE_FILES) {
    try {
      if ((await api.workspace.exists(f)) !== 'file') continue
      const file = await api.workspace.readFile(f)
      if (file.binary || file.tooLarge) continue
      const text = file.content.trim()
      if (text) parts.push(`From ${f}:\n${text.slice(0, 4000)}`)
      if (parts.join('').length > 6000) break
    } catch {
      // unreadable rule file
    }
  }
  return parts.join('\n\n')
}

async function topLevel(): Promise<string> {
  const ws = useWorkspace.getState()
  let root: DirEntry[] | undefined = ws.children['']
  if (!root) {
    try {
      root = await api.workspace.listDir('')
    } catch {
      root = []
    }
  }
  const lines: string[] = []
  for (const e of root.slice(0, 60)) {
    if (e.ignored) continue
    lines.push(e.kind === 'dir' ? `${e.name}/` : e.name)
  }
  if (root.length > 60) lines.push(`... ${root.length - 60} more`)
  return lines.join('\n')
}

function focusContext(): string {
  const tab = activeTab()
  if (!tab || tab.kind !== 'file') return ''
  const ed = editorHost.editor
  const sel = ed?.getSelection()
  let line = `The user has ${tab.path} open in the editor`
  if (sel && !sel.isEmpty()) line += `, with lines ${sel.startLineNumber} to ${sel.endLineNumber} selected`
  else if (sel) line += `, cursor on line ${sel.positionLineNumber}`
  return line + '.'
}

const AGENT_RULES = `You are in Agent mode. You can read and search files, change them, and run commands with your tools.
How to work:
- Look before you change anything: read the relevant files first. Never guess what a file contains.
- For a small change, use edit_file. Copy old_text exactly from read_file output, including indentation, and include 2 or 3 unchanged lines around the change so it matches one place only.
- new_text replaces all of old_text, so repeat in new_text every line of old_text that must stay. Never drop existing code the user did not ask you to remove. To add code at the end of a file (a new function, a new test), call edit_file with an empty old_text; to add it elsewhere, put a nearby existing line in old_text and the same line plus the new code in new_text.
- Use write_file to create new files. For an existing file, read it and use edit_file, even to add a lot of code.
- Follow the conventions already in the project: the same test framework, import style (including file extensions) and formatting. Add new tests next to the existing ones.
- Paths are relative to the project root and use forward slashes.
- Use run_command for tests, builds, linters and package installs. Pick commands that finish on their own; never start a dev server or a watcher.
- Do one step at a time and check results. If a tool fails, read the error and fix your call.
- If tests or a build fail after your change, read the output, fix the cause in the code or the test, and run them again. Do not suggest new tools or frameworks the project does not use.
- When the task is done, stop calling tools and reply with a short summary of what changed. Do not paste whole files into the reply.`

const ASK_RULES = `You are in Ask mode. You can read and search files with your tools, but you cannot change files or run commands.
If a change would help, show it as a short code block and mention that Agent mode can apply it.`

const NO_TOOLS = `This model cannot use tools, so you cannot open files yourself. Work from the context the user attached. If you need a file, ask the user to attach it with @.`

export async function buildSystemPrompt(mode: 'agent' | 'ask', toolsEnabled: boolean): Promise<string> {
  const info = await getAppInfo()
  const ws = useWorkspace.getState().info
  const [tree, rules] = await Promise.all([ws ? topLevel() : Promise.resolve(''), ws ? projectRules() : Promise.resolve('')])
  const shellNote =
    info.platform === 'win32'
      ? '. Write PowerShell, not bash: Remove-Item -Recurse -Force instead of rm -rf, New-Item -ItemType Directory -Force instead of mkdir -p, $env:NAME = "value" instead of export, Get-Content instead of cat, curl.exe instead of curl. "&&" works.'
      : ''
  const sections = [
    `You are Hearth, a careful and friendly coding assistant. You run on the user's own computer through a local model${ws ? ` and you are working in the project "${ws.name}"` : ''}.`,
    [
      'Environment:',
      `- Operating system: ${info.osName} (${info.arch})`,
      `- Shell used by run_command: ${info.shellName}${shellNote}`,
      ws ? `- Project folder: ${ws.root}` : '',
      `- Today: ${new Date().toISOString().slice(0, 10)}`
    ]
      .filter(Boolean)
      .join('\n'),
    toolsEnabled ? (mode === 'agent' ? AGENT_RULES : ASK_RULES) : NO_TOOLS,
    'Reply in the language the user writes in. Be concise and concrete. Use Markdown, and put code in fenced blocks with a language name.',
    tree ? `Top level of the project:\n${tree}` : '',
    focusContext(),
    rules ? `Project instructions written by the user. Follow them:\n${rules}` : ''
  ]
  return sections.filter(Boolean).join('\n\n')
}
