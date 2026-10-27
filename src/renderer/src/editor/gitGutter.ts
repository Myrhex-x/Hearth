import { lineChanges } from '../../../shared/gitText'
import { api } from '../api'
import { monaco } from '../lib/monaco'
import { activeTab } from '../state/editor'
import { useGit } from '../state/git'

// Bars in the gutter for lines changed since the last commit, like every editor
// with source control shows them.

const MAX_LINES = 20000
const CLASS = { added: 'git-gutter-added', modified: 'git-gutter-modified', deleted: 'git-gutter-deleted' } as const

export function attachGitGutter(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  const decorations = editor.createDecorationsCollection()
  const committed = new Map<string, string | null>()
  let head: string | null | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let run = 0

  const update = async () => {
    const id = ++run
    const model = editor.getModel()
    const tab = activeTab()
    const status = useGit.getState().status
    if (!model || tab?.kind !== 'file' || !status?.isRepo || model.getLineCount() > MAX_LINES) {
      decorations.clear()
      return
    }
    if (status.head !== head) {
      committed.clear()
      head = status.head
    }
    const change = useGit.getState().byPath.get(tab.path)
    let base = committed.get(tab.path)
    if (base === undefined) {
      base = change?.kind === 'untracked' || change?.kind === 'added' ? null : await api.git.showHead(tab.path).catch(() => null)
      committed.set(tab.path, base)
    }
    if (id !== run || editor.getModel() !== model) return
    // Not in the last commit: only mark it when git knows the file is new.
    if (base === null && !change) {
      decorations.clear()
      return
    }
    const changes = lineChanges(base ?? '', model.getValue())
    decorations.set(
      changes.map((c) => ({
        range: new monaco.Range(c.start, 1, c.end, 1),
        options: { isWholeLine: true, linesDecorationsClassName: CLASS[c.kind], overviewRuler: undefined }
      }))
    )
  }

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void update(), delay)
  }

  const subs = [
    editor.onDidChangeModel(() => schedule(0)),
    editor.onDidChangeModelContent(() => schedule(350))
  ]
  const unsubscribe = useGit.subscribe((s, prev) => {
    if (s.status !== prev.status) {
      // A commit or checkout changes what "committed" means for open files.
      if (s.status?.head !== prev.status?.head) committed.clear()
      for (const f of s.status?.files ?? []) {
        const before = prev.byPath.get(f.path)
        if (before?.kind !== f.kind) committed.delete(f.path)
      }
      schedule(50)
    }
  })

  return {
    dispose() {
      if (timer) clearTimeout(timer)
      for (const s of subs) s.dispose()
      unsubscribe()
      decorations.clear()
    }
  }
}
