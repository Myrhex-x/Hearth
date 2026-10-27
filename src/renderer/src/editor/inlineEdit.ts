import type { ChatEvent } from '../../../shared/types'
import { api, isMac, uid } from '../api'
import { shortModelName } from '../lib/format'
import { languageLabel, monaco } from '../lib/monaco'
import { activeTab, editorHost, markClean } from '../state/editor'
import { modelById, supportsThinking, useModels } from '../state/models'
import { settingsNow } from '../state/settings'
import { toast } from '../state/ui'

// Cmd+K / Ctrl+K: describe a change, watch the model rewrite the selection in
// place, then keep it or put the original back.

const SYSTEM = `You are the code rewriting engine of a code editor.
You receive part of a file and an instruction. Reply with ONLY the code that replaces the selected part:
- no explanations, no Markdown fences, no line numbers
- keep the indentation style of the file
- keep everything the instruction does not ask to change
If nothing is selected, reply with only the code to insert at the cursor.`

type Phase = 'prompt' | 'streaming' | 'review'

let session: InlineSession | null = null

export function startInlineEdit(): void {
  const ed = editorHost.editor
  const model = ed?.getModel()
  const tab = activeTab()
  if (!ed || !model || tab?.kind !== 'file') return
  if (session) {
    session.focus()
    return
  }
  if (!(settingsNow().inlineEditModel ?? settingsNow().chatModel)) {
    toast('Choose a model first. Click the ember in the title bar.', 'error')
    return
  }
  session = new InlineSession(ed, model, tab.path)
}

export function cancelInlineEdit(): void {
  session?.reject()
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function stripFences(text: string): string {
  let t = text
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n')
    if (nl < 0) return ''
    t = t.slice(nl + 1)
  }
  const fence = t.lastIndexOf('```')
  if (fence >= 0 && t.slice(fence).trim() === '```') t = t.slice(0, fence)
  return t
}

function baseIndent(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')
  return line ? /^[ \t]*/.exec(line)![0] : ''
}

class InlineSession {
  private phase: Phase = 'prompt'
  private range: monaco.Range
  private original: string
  private startOffset: number
  private currentLength: number
  private wasClean: boolean
  private zoneId: string | null = null
  private removedZoneId: string | null = null
  private widget: monaco.editor.IOverlayWidget
  private dom: HTMLDivElement
  private input: HTMLTextAreaElement
  private status: HTMLSpanElement
  private actions: HTMLDivElement
  private decorations: monaco.editor.IEditorDecorationsCollection
  private requestId: string | null = null
  private disposables: monaco.IDisposable[] = []
  private instruction = ''

  constructor(
    private ed: monaco.editor.IStandaloneCodeEditor,
    private model: monaco.editor.ITextModel,
    private path: string
  ) {
    const sel = ed.getSelection() ?? new monaco.Selection(1, 1, 1, 1)
    if (sel.isEmpty()) {
      const line = sel.positionLineNumber
      const content = model.getLineContent(line)
      this.range = content.trim() === '' ? new monaco.Range(line, 1, line, content.length + 1) : new monaco.Range(line, 1, line, 1)
    } else {
      const endLine = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
      this.range = new monaco.Range(sel.startLineNumber, 1, endLine, model.getLineMaxColumn(endLine))
    }
    this.original = model.getValueInRange(this.range)
    this.startOffset = model.getOffsetAt(this.range.getStartPosition())
    this.currentLength = this.original.length
    this.wasClean = !activeTab()?.dirty
    this.decorations = ed.createDecorationsCollection()

    this.dom = el('div', 'inline-edit')
    this.layoutWidth()
    const glyph = el('span', 'inline-edit-glyph')
    glyph.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 14V7.5a4.5 4.5 0 0 1 9 0V14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="7.3" y="8" width="1.4" height="4.6" rx=".7" fill="var(--ember)"/></svg>'
    this.input = el('textarea', 'inline-edit-input')
    this.input.rows = 1
    this.input.placeholder = this.original.trim() ? 'Describe the change to the selected code' : 'Describe the code to write here'
    this.input.spellcheck = false
    this.status = el('span', 'inline-edit-status')
    const modelId = settingsNow().inlineEditModel ?? settingsNow().chatModel
    this.status.textContent = shortModelName(modelById(modelId)?.name ?? modelId?.split('::')[1])
    this.actions = el('div', 'inline-edit-actions')
    const top = el('div', 'inline-edit-row')
    top.append(glyph, this.input, this.status, this.actions)
    this.dom.append(top)
    this.renderActions()

    this.input.addEventListener('keydown', (e) => this.onKey(e))
    this.input.addEventListener('input', () => this.autosize())
    this.dom.addEventListener('mousedown', (e) => e.stopPropagation())

    // A view zone reserves the space between lines; an overlay widget sits on
    // top of it and follows it while the editor scrolls.
    this.widget = {
      getId: () => 'hearth.inlineEdit',
      getDomNode: () => this.dom,
      getPosition: () => null
    }
    ed.addOverlayWidget(this.widget)
    this.addPromptZone(56)
    if (this.original.trim()) {
      this.decorations.set([
        { range: new monaco.Range(this.range.startLineNumber, 1, this.range.endLineNumber, 1), options: { isWholeLine: true, className: 'hearth-inline-target' } }
      ])
    }
    ed.setSelection(new monaco.Selection(this.range.startLineNumber, 1, this.range.startLineNumber, 1))
    ed.revealLineInCenterIfOutsideViewport(this.range.startLineNumber)

    this.disposables.push(
      ed.onDidChangeModel(() => this.reject()),
      ed.onDidDispose(() => this.cleanup()),
      ed.onDidLayoutChange(() => this.layoutWidth())
    )
    setTimeout(() => this.focus(), 0)
  }

  focus(): void {
    if (this.phase === 'prompt') this.input.focus()
    else this.dom.querySelector<HTMLButtonElement>('.accept')?.focus()
  }

  private layoutWidth(): void {
    const info = this.ed.getLayoutInfo()
    this.dom.style.left = `${info.contentLeft + 2}px`
    this.dom.style.width = `${Math.min(680, Math.max(300, info.contentWidth - 40))}px`
  }

  private addPromptZone(height: number): void {
    this.ed.changeViewZones((acc) => {
      if (this.zoneId) acc.removeZone(this.zoneId)
      this.zoneId = acc.addZone({
        afterLineNumber: this.range.startLineNumber - 1,
        heightInPx: height,
        domNode: el('div'),
        ordinal: 1,
        onDomNodeTop: (top) => {
          this.dom.style.top = `${top + 6}px`
        }
      })
    })
  }

  private autosize(): void {
    this.input.style.height = 'auto'
    this.input.style.height = `${Math.min(120, this.input.scrollHeight)}px`
    this.addPromptZone(Math.max(56, this.dom.offsetHeight + 12))
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation()
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      this.reject()
    } else if (e.key === 'Enter' && !e.shiftKey && this.phase === 'prompt') {
      e.preventDefault()
      void this.generate()
    } else if (e.key === 'Enter' && mod && this.phase === 'review') {
      e.preventDefault()
      this.accept()
    }
  }

  private button(label: string, cls: string, onClick: () => void, hint?: string): HTMLButtonElement {
    const b = el('button', `inline-edit-btn ${cls}`)
    b.append(el('span', '', label))
    if (hint) b.append(el('kbd', '', hint))
    b.addEventListener('click', (e) => {
      e.preventDefault()
      onClick()
    })
    b.addEventListener('keydown', (e) => this.onKey(e))
    return b
  }

  private renderActions(): void {
    this.actions.replaceChildren()
    const mod = isMac ? '⌘' : 'Ctrl+'
    if (this.phase === 'prompt') {
      this.actions.append(this.button('Cancel', 'quiet', () => this.reject(), 'esc'))
    } else if (this.phase === 'streaming') {
      this.actions.append(this.button('Stop', 'quiet', () => this.reject(), 'esc'))
    } else {
      this.actions.append(this.button('Undo', 'quiet', () => this.reject(), 'esc'), this.button('Keep', 'accept', () => this.accept(), `${mod}↩`))
    }
  }

  private currentRange(): monaco.Range {
    const start = this.model.getPositionAt(this.startOffset)
    const end = this.model.getPositionAt(this.startOffset + this.currentLength)
    return monaco.Range.fromPositions(start, end)
  }

  private setText(text: string): void {
    const eolText = text.replace(/\r?\n/g, this.model.getEOL())
    this.model.applyEdits([{ range: this.currentRange(), text: eolText }])
    this.currentLength = eolText.length
    const r = this.currentRange()
    if (eolText.length) {
      this.decorations.set([{ range: new monaco.Range(r.startLineNumber, 1, r.endLineNumber, 1), options: { isWholeLine: true, className: 'hearth-inline-added' } }])
    } else this.decorations.clear()
  }

  private showRemoved(): void {
    if (!this.original.trim()) return
    const lines = this.original.split(/\r?\n/)
    const lineHeight = this.ed.getOption(monaco.editor.EditorOption.lineHeight)
    const dom = el('div', 'hearth-inline-removed')
    for (const l of lines) dom.append(el('div', 'line', l || ' '))
    dom.style.lineHeight = `${lineHeight}px`
    dom.style.fontSize = `${this.ed.getOption(monaco.editor.EditorOption.fontSize)}px`
    this.ed.changeViewZones((acc) => {
      this.removedZoneId = acc.addZone({ afterLineNumber: this.range.startLineNumber - 1, heightInLines: lines.length, domNode: dom, ordinal: 2 })
    })
  }

  private async generate(): Promise<void> {
    this.instruction = this.input.value.trim()
    if (!this.instruction) return
    const settings = settingsNow()
    const modelId = settings.inlineEditModel ?? settings.chatModel
    if (!modelId) return
    this.phase = 'streaming'
    this.input.readOnly = true
    this.dom.classList.add('busy')
    this.status.textContent = 'Writing'
    this.renderActions()
    this.ed.updateOptions({ readOnly: true })
    this.showRemoved()

    const total = this.model.getLineCount()
    const before = this.model.getValueInRange(new monaco.Range(Math.max(1, this.range.startLineNumber - 80), 1, this.range.startLineNumber, 1))
    const after = this.model.getValueInRange(
      new monaco.Range(this.range.endLineNumber, this.model.getLineMaxColumn(this.range.endLineNumber), Math.min(total, this.range.endLineNumber + 40), this.model.getLineMaxColumn(Math.min(total, this.range.endLineNumber + 40)))
    )
    const lang = languageLabel(this.model.getLanguageId())
    const user = [
      `File: ${this.path} (${lang})`,
      `Code before the selection:\n<before>\n${before}</before>`,
      this.original.trim() ? `Selected code to rewrite:\n<selection>\n${this.original}\n</selection>` : 'Nothing is selected: the new code goes between <before> and <after>.',
      `Code after the selection:\n<after>${after}\n</after>`,
      `Instruction: ${this.instruction}`,
      this.original.trim() ? 'Reply with the replacement for the selected code only.' : 'Reply with the code to insert only.'
    ].join('\n\n')

    const indent = baseIndent(this.original)
    let raw = ''
    const requestId = uid('inline')
    this.requestId = requestId
    useModels.setState({ activity: 'waiting', activityModel: modelId })
    let chars = 0
    const startedAt = Date.now()
    const done = new Promise<string | null>((resolve) => {
      const off = api.llm.onChatEvent(requestId, (e: ChatEvent) => {
        if (e.type === 'content') {
          raw += e.text
          chars += e.text.length
          const secs = (Date.now() - startedAt) / 1000
          useModels.setState({ activity: 'streaming', liveTokens: secs > 0.5 ? chars / 3.6 / secs : 0 })
          if (this.phase === 'streaming') this.setText(this.reindent(stripFences(raw.replace(/^\s*\n/, '')), indent))
        } else if (e.type === 'done') {
          off()
          resolve(raw)
        } else if (e.type === 'error') {
          off()
          toast(e.message, 'error')
          resolve(null)
        }
      })
    })
    api.llm.chat(requestId, {
      modelId,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      contextWindow: settings.contextWindow,
      keepAlive: settings.keepAlive,
      think: supportsThinking(modelId) ? false : undefined
    })
    const result = await done
    useModels.setState({ activity: 'idle', liveTokens: 0 })
    void useModels.getState().refreshLoaded()
    this.requestId = null
    if (this.phase !== 'streaming') return
    if (result === null || !stripFences(result).trim()) {
      if (result !== null) toast('The model returned nothing to insert.', 'error')
      this.reject()
      return
    }
    this.setText(this.reindent(stripFences(result.replace(/^\s*\n/, '')).replace(/\s+$/, ''), indent))
    this.phase = 'review'
    this.dom.classList.remove('busy')
    this.status.textContent = ''
    this.renderActions()
    this.ed.updateOptions({ readOnly: false })
    this.focus()
  }

  private reindent(text: string, indent: string): string {
    if (!indent) return text
    const lines = text.split('\n')
    const nonEmpty = lines.filter((l) => l.trim() !== '')
    if (!nonEmpty.length || nonEmpty.some((l) => /^[ \t]/.test(l))) return text
    return lines.map((l) => (l.trim() ? indent + l : l)).join('\n')
  }

  accept(): void {
    if (this.phase !== 'review') return
    const finalText = this.model.getValueInRange(this.currentRange())
    this.restoreOriginal()
    this.model.pushStackElement()
    this.model.pushEditOperations([], [{ range: this.currentRange(), text: finalText }], () => null)
    this.model.pushStackElement()
    const end = this.model.getPositionAt(this.startOffset + finalText.length)
    this.ed.setSelection(monaco.Selection.fromPositions(end, end))
    this.cleanup()
  }

  reject(): void {
    if (this.requestId) api.llm.abort(this.requestId)
    const changed = this.phase !== 'prompt'
    this.phase = 'prompt'
    if (changed) {
      this.restoreOriginal()
      if (this.wasClean) markClean(this.path)
    }
    this.cleanup()
  }

  private restoreOriginal(): void {
    if (this.model.isDisposed()) return
    this.model.applyEdits([{ range: this.currentRange(), text: this.original }])
    this.currentLength = this.original.length
  }

  private cleanup(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    if (!this.model.isDisposed()) this.decorations.clear()
    this.ed.changeViewZones((acc) => {
      if (this.zoneId) acc.removeZone(this.zoneId)
      if (this.removedZoneId) acc.removeZone(this.removedZoneId)
    })
    this.ed.removeOverlayWidget(this.widget)
    this.ed.updateOptions({ readOnly: false })
    if (session === this) session = null
    this.ed.focus()
  }
}
