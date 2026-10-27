import { api, uid } from '../api'
import { monaco } from '../lib/monaco'
import { useModels } from '../state/models'
import { settingsNow } from '../state/settings'

// Ghost-text completions from a fill-in-the-middle model (qwen2.5-coder,
// starcoder2, codegemma, deepseek-coder...). Tab accepts, as in any editor.

const PREFIX_CHARS = 5000
const SUFFIX_CHARS = 1500

export function cleanCompletion(raw: string, lineSuffix: string, docAfter: string): string {
  let text = raw.replace(/\r\n/g, '\n').replace(/<\|[a-z_]+\|>/gi, '').replace(/<fim_[a-z]+>/gi, '')
  let lines = text.split('\n')
  if (lines.length > 14) lines = lines.slice(0, 14)
  // Stop where the model starts repeating code that already follows the cursor.
  const following = docAfter
    .split('\n')
    .slice(1, 8)
    .map((l) => l.trim())
    .filter(Boolean)
  if (following.length) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() && lines[i].trim() === following[0]) {
        lines = lines.slice(0, i)
        break
      }
    }
  }
  text = lines.join('\n')
  const rest = lineSuffix.trim()
  if (rest && !text.includes('\n') && text.trimEnd().endsWith(rest)) text = text.trimEnd().slice(0, -rest.length)
  return text.replace(/[ \t\n]+$/, '')
}

export function registerAutocomplete(): monaco.IDisposable {
  return monaco.languages.registerInlineCompletionsProvider('*', {
    debounceDelayMs: 260,
    async provideInlineCompletions(model, position, _context, token) {
      const settings = settingsNow()
      const modelId = settings.autocompleteModel
      if (!settings.autocompleteEnabled || !modelId || model.uri.scheme !== 'file') return { items: [] }
      if (model.getValueLength() > 2_000_000) return { items: [] }
      const line = model.getLineContent(position.lineNumber)
      const lineSuffix = line.slice(position.column - 1)
      // Mid-word: wait until the cursor is at a natural break.
      if (/^[\w$]/.test(lineSuffix)) return { items: [] }
      const offset = model.getOffsetAt(position)
      const startOffset = Math.max(0, offset - PREFIX_CHARS)
      const prefix = model.getValueInRange(monaco.Range.fromPositions(model.getPositionAt(startOffset), position))
      const endPos = model.getPositionAt(Math.min(model.getValueLength(), offset + SUFFIX_CHARS))
      const suffix = model.getValueInRange(monaco.Range.fromPositions(position, endPos))
      if (!prefix.trim()) return { items: [] }

      const requestId = uid('fim')
      const sub = token.onCancellationRequested(() => api.llm.abort(requestId))
      useModels.setState({ autocompleteBusy: true })
      try {
        const raw = await api.llm.complete(requestId, {
          modelId,
          prefix: prefix.replace(/\r\n/g, '\n'),
          suffix: suffix.replace(/\r\n/g, '\n'),
          maxTokens: 96,
          temperature: 0.1,
          stop: ['\n\n\n'],
          keepAlive: settings.keepAlive
        })
        if (useModels.getState().autocompleteError) useModels.setState({ autocompleteError: null })
        if (token.isCancellationRequested) return { items: [] }
        const text = cleanCompletion(raw, lineSuffix, suffix)
        if (!text.trim()) return { items: [] }
        return {
          items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }]
        }
      } catch (err) {
        if (!token.isCancellationRequested) {
          const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          useModels.setState({ autocompleteError: /insert|suffix/i.test(msg) ? 'This model cannot fill in the middle. Pick a code model for autocomplete.' : msg })
        }
        return { items: [] }
      } finally {
        sub.dispose()
        useModels.setState({ autocompleteBusy: false })
      }
    },
    disposeInlineCompletions() {}
  })
}
