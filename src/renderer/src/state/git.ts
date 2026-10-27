import { create } from 'zustand'
import type { ChatEvent, GitFileStatus, GitStatus } from '../../../shared/types'
import { cleanCommitMessage, condenseDiff } from '../../../shared/gitText'
import { api, isStore, isWin, uid } from '../api'
import { supportsThinking, useModels } from './models'
import { settingsNow } from './settings'
import { toast, useUi } from './ui'
import { useWorkspace } from './workspace'

type Busy = 'commit' | 'push' | 'pull' | 'fetch' | 'init' | null

interface GitStore {
  status: GitStatus | null
  byPath: Map<string, GitFileStatus>
  /** Folders that contain a changed file, for the dots in the file tree. */
  changedDirs: Set<string>
  message: string
  writing: boolean
  busy: Busy
  refresh(): Promise<void>
  scheduleRefresh(delay?: number): void
  reset(): void
  setMessage(message: string): void
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(files: GitFileStatus[]): Promise<void>
  commit(): Promise<void>
  push(): Promise<void>
  pull(): Promise<void>
  fetch(): Promise<void>
  init(): Promise<void>
  writeMessage(): Promise<void>
  stopWriting(): void
}

let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
let again = false
let writingRequest: string | null = null

function index(status: GitStatus | null): Pick<GitStore, 'byPath' | 'changedDirs'> {
  const byPath = new Map<string, GitFileStatus>()
  const changedDirs = new Set<string>()
  for (const f of status?.files ?? []) {
    byPath.set(f.path, f)
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) changedDirs.add(parts.slice(0, i).join('/'))
  }
  return { byPath, changedDirs }
}

function errorText(err: unknown): string {
  const msg = (err as Error).message ?? String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim()
}

async function act(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    const text = errorText(err)
    toast(`${label}: ${text.length > 360 ? text.slice(0, 360) + '…' : text}`, 'error')
    return false
  }
}

export const useGit = create<GitStore>((set, get) => ({
  status: null,
  byPath: new Map(),
  changedDirs: new Set(),
  message: '',
  writing: false,
  busy: null,

  async refresh() {
    if (!useWorkspace.getState().info) return
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      try {
        const status = await api.git.status()
        set({ status, ...index(status) })
      } catch {
        // the folder closed while git was running
      }
    })().finally(() => {
      inflight = null
      if (again) {
        again = false
        void get().refresh()
      }
    })
    return inflight
  },

  scheduleRefresh(delay = 400) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void get().refresh()
    }, delay)
  },

  reset() {
    get().stopWriting()
    set({ status: null, byPath: new Map(), changedDirs: new Set(), message: '', busy: null })
  },

  setMessage(message) {
    set({ message })
  },

  async stage(paths) {
    if (await act('Could not stage', () => api.git.stage(paths))) await get().refresh()
  },

  async unstage(paths) {
    if (await act('Could not unstage', () => api.git.unstage(paths))) await get().refresh()
  },

  async discard(files) {
    if (!files.length) return
    const untracked = files.filter((f) => f.kind === 'untracked')
    const tracked = files.filter((f) => f.kind !== 'untracked')
    const what = files.length === 1 ? `“${files[0].path.split('/').pop()}”` : `${files.length} files`
    const choice = await api.app.messageBox({
      type: 'warning',
      message: `Discard the changes to ${what}?`,
      detail: [
        tracked.length ? 'Edits to tracked files go back to their last staged or committed version. This cannot be undone.' : '',
        untracked.length ? `New files move to the ${isWin ? 'Recycle Bin' : 'Trash'}.` : ''
      ]
        .filter(Boolean)
        .join(' '),
      buttons: ['Discard', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice !== 0) return
    if (tracked.length) await act('Could not discard', () => api.git.discard(tracked.map((f) => f.path)))
    for (const f of untracked) await act(`Could not remove ${f.path}`, () => api.workspace.trash(f.path))
    await get().refresh()
  },

  async commit() {
    const message = get().message.trim()
    const status = get().status
    if (!status?.isRepo || get().busy) return
    if (!message) {
      toast('Write a commit message first, or let the model write one.')
      return
    }
    const staged = status.files.some((f) => f.staged)
    if (!staged && !status.files.length) {
      toast('There is nothing to commit.')
      return
    }
    set({ busy: 'commit' })
    let summary = ''
    const ok = await act('Commit failed', async () => {
      try {
        summary = await api.git.commit(message, !staged)
      } catch (err) {
        // The store edition cannot read ~/.gitconfig: point to where the name and email go instead.
        if (isStore && /tell me who you are|empty ident/i.test(errorText(err))) {
          useUi.getState().openSettings('editor')
          throw new Error('Git needs your name and email. Add them under Source control.')
        }
        throw err
      }
    })
    set({ busy: null })
    if (ok) {
      set({ message: '' })
      toast(`Committed ${summary}`, 'success')
      void useWorkspace.getState().refreshBranch()
    }
    await get().refresh()
  },

  async push() {
    set({ busy: 'push' })
    const ok = await act('Push failed', () => api.git.push())
    set({ busy: null })
    if (ok) toast('Pushed', 'success')
    await get().refresh()
  },

  async pull() {
    set({ busy: 'pull' })
    const ok = await act('Pull failed', () => api.git.pull())
    set({ busy: null })
    if (ok) toast('Up to date', 'success')
    await get().refresh()
  },

  async fetch() {
    set({ busy: 'fetch' })
    await act('Fetch failed', () => api.git.fetch())
    set({ busy: null })
    await get().refresh()
  },

  async init() {
    set({ busy: 'init' })
    await act('Could not create the repository', () => api.git.init())
    set({ busy: null })
    await get().refresh()
    void useWorkspace.getState().refreshBranch()
  },

  async writeMessage() {
    if (get().writing) return
    const settings = settingsNow()
    const modelId = settings.chatModel
    if (!modelId) {
      toast('Choose a model first. Click the ember in the title bar.', 'error')
      return
    }
    let summary
    try {
      summary = await api.git.summary()
    } catch (err) {
      toast(`Could not read the changes: ${errorText(err)}`, 'error')
      return
    }
    if (!summary.diff.trim() && !summary.untracked.length) {
      toast('There are no changes to describe.')
      return
    }
    const parts = [
      summary.recent.length ? `Recent commit messages in this repository. Match their style:\n${summary.recent.map((r) => `- ${r}`).join('\n')}` : '',
      summary.untracked.length ? `New files: ${summary.untracked.slice(0, 40).join(', ')}` : '',
      summary.diff.trim() ? `The changes:\n${condenseDiff(summary.diff)}` : ''
    ].filter(Boolean)
    const requestId = uid('commitmsg')
    writingRequest = requestId
    set({ writing: true, message: '' })
    useModels.setState({ activity: 'waiting', activityModel: modelId })
    let raw = ''
    await new Promise<void>((resolve) => {
      const off = api.llm.onChatEvent(requestId, (e: ChatEvent) => {
        if (e.type === 'content') {
          raw += e.text
          useModels.setState({ activity: 'streaming' })
          if (writingRequest === requestId) set({ message: raw.replace(/^```[a-z]*\n?/i, '') })
        } else if (e.type === 'done' || e.type === 'error') {
          off()
          if (e.type === 'error') toast(e.message, 'error')
          resolve()
        }
      })
      api.llm.chat(requestId, {
        modelId,
        messages: [
          {
            role: 'system',
            content:
              'You write git commit messages. Reply with the commit message only: a summary line in the imperative mood ("Add", "Fix", "Remove"...), under 72 characters, with no period at the end. If the change needs explaining, add a blank line and a short body that says why, wrapped at 72 characters. No Markdown, no code fences, no quotes, no preamble.'
          },
          { role: 'user', content: parts.join('\n\n') }
        ],
        temperature: 0.2,
        contextWindow: settings.contextWindow,
        keepAlive: settings.keepAlive,
        think: supportsThinking(modelId) ? false : undefined,
        maxTokens: 2000
      })
    })
    useModels.setState({ activity: 'idle', liveTokens: 0 })
    if (writingRequest === requestId) {
      writingRequest = null
      set({ writing: false, message: cleanCommitMessage(raw) })
    }
  },

  stopWriting() {
    if (writingRequest) api.llm.abort(writingRequest)
    writingRequest = null
    set({ writing: false })
  }
}))

export function gitLetter(f: GitFileStatus): string {
  switch (f.kind) {
    case 'untracked':
      return 'U'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'conflict':
      return '!'
    case 'typechange':
      return 'T'
    default:
      return 'M'
  }
}
