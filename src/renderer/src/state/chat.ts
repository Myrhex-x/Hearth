import { create } from 'zustand'
import type { ChatEvent, GenStats, LlmMessage, ToolCall, ToolSpec } from '../../../shared/types'
import { isLooping } from '../../../shared/loop'
import { extractToolCalls } from '../../../shared/toolText'
import { api, uid } from '../api'
import { buildSystemPrompt } from '../agent/prompt'
import { describeCall, executeTool, READ_ONLY_TOOLS, TOOL_NAMES, TOOL_SPECS, type Decision } from '../agent/tools'
import type { AssistantPart, ChatMessage, ChatThread, ContextChip, FileChange, ToolStep } from '../agent/types'
import { shortModelName } from '../lib/format'
import { basename } from '../lib/paths'
import { activeTab, openText, writeFileContent } from './editor'
import { modelById, supportsThinking, supportsTools, useModels } from './models'
import { settingsNow } from './settings'
import { toast } from './ui'

export type ChatMode = 'agent' | 'ask'

interface ChatStore {
  threads: ChatThread[]
  activeId: string | null
  runningThread: string | null
  mode: ChatMode
  draft: string
  chips: ContextChip[]
  activeFileDismissed: string | null
  newThread(): void
  select(id: string): void
  deleteThread(id: string): void
  load(threads: ChatThread[], activeId: string | null): void
  setMode(mode: ChatMode): void
  setDraft(text: string): void
  addChip(chip: ContextChip): void
  removeChip(index: number): void
  dismissActiveFile(path: string | null): void
  send(text: string): Promise<void>
  stop(): void
  decide(stepId: string, decision: Decision): void
  revert(messageId: string, path?: string): Promise<void>
}

const approvals = new Map<string, (d: Decision) => void>()
let currentRequest: string | null = null
let currentExec: string | null = null
let stopped = false

function threadTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 52 ? t.slice(0, 50).trimEnd() + '…' : t || 'New chat'
}

function emptyThread(): ChatThread {
  const now = Date.now()
  return { id: uid('thread'), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

export const useChat = create<ChatStore>((set, get) => ({
  threads: [],
  activeId: null,
  runningThread: null,
  mode: 'agent',
  draft: '',
  chips: [],
  activeFileDismissed: null,

  newThread() {
    const cur = get().threads.find((t) => t.id === get().activeId)
    if (cur && cur.messages.length === 0) {
      set({ chips: [], draft: '' })
      return
    }
    const t = emptyThread()
    set({ threads: [t, ...get().threads], activeId: t.id, chips: [], draft: '' })
  },

  select(id) {
    set({ activeId: id })
  },

  deleteThread(id) {
    if (get().runningThread === id) get().stop()
    const threads = get().threads.filter((t) => t.id !== id)
    set({ threads, activeId: get().activeId === id ? (threads[0]?.id ?? null) : get().activeId })
  },

  load(threads, activeId) {
    // Turns interrupted by a reload cannot resume; mark them finished.
    const clean = threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.role === 'assistant' && !m.done
          ? {
              ...m,
              done: true,
              parts: (m.parts ?? []).map((p) =>
                p.kind === 'tool' && (p.step.status === 'running' || p.step.status === 'awaiting') ? { ...p, step: { ...p.step, status: 'stopped' as const } } : p
              )
            }
          : m
      )
    }))
    set({ threads: clean, activeId: activeId && clean.some((t) => t.id === activeId) ? activeId : (clean[0]?.id ?? null), chips: [], draft: '' })
  },

  setMode(mode) {
    set({ mode })
  },

  setDraft(text) {
    set({ draft: text })
  },

  addChip(chip) {
    const exists = get().chips.some((c) => c.kind === chip.kind && c.path === chip.path && c.startLine === chip.startLine && c.endLine === chip.endLine)
    if (!exists) set({ chips: [...get().chips, chip] })
  },

  removeChip(index) {
    set({ chips: get().chips.filter((_, i) => i !== index) })
  },

  dismissActiveFile(path) {
    set({ activeFileDismissed: path })
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().runningThread) return
    const settings = settingsNow()
    const modelId = settings.chatModel
    if (!modelId) {
      toast('Choose a model first. Click the ember in the title bar to see what is installed.', 'error')
      return
    }
    let thread = get().threads.find((t) => t.id === get().activeId)
    if (!thread) {
      thread = emptyThread()
      set({ threads: [thread, ...get().threads], activeId: thread.id })
    }
    const chips = [...get().chips]
    const tab = activeTab()
    if (tab?.kind === 'file' && get().activeFileDismissed !== tab.path && !chips.some((c) => c.path === tab.path && c.kind === 'file')) {
      chips.unshift({ kind: 'file', path: tab.path })
    }
    const userMsg: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      createdAt: Date.now(),
      text: trimmed,
      chips,
      llmContent: await withContext(trimmed, chips)
    }
    const assistant: ChatMessage = {
      id: uid('msg'),
      role: 'assistant',
      createdAt: Date.now(),
      parts: [],
      modelId,
      mode: get().mode,
      transcript: [],
      changes: []
    }
    const threadId = thread.id
    patchThread(threadId, (t) => ({
      ...t,
      title: t.messages.length === 0 ? threadTitle(trimmed) : t.title,
      updatedAt: Date.now(),
      messages: [...t.messages, userMsg, assistant]
    }))
    set({ draft: '', chips: [], runningThread: threadId, activeFileDismissed: null })
    stopped = false
    try {
      await runTurn(threadId, assistant.id)
    } catch (err) {
      patchMessage(threadId, assistant.id, (m) => ({ ...m, error: (err as Error).message }))
    } finally {
      patchMessage(threadId, assistant.id, (m) => ({ ...m, done: true }))
      set({ runningThread: null })
      useModels.setState({ activity: 'idle', liveTokens: 0 })
      currentRequest = null
      void useModels.getState().refreshLoaded()
    }
  },

  stop() {
    stopped = true
    if (currentRequest) api.llm.abort(currentRequest)
    if (currentExec) api.exec.abort(currentExec)
    for (const [id, resolve] of approvals) {
      resolve({ approved: false, feedback: 'Stopped by the user.' })
      approvals.delete(id)
    }
  },

  decide(stepId, decision) {
    const resolve = approvals.get(stepId)
    if (resolve) {
      approvals.delete(stepId)
      resolve(decision)
    }
  },

  async revert(messageId, path) {
    const thread = get().threads.find((t) => t.messages.some((m) => m.id === messageId))
    const msg = thread?.messages.find((m) => m.id === messageId)
    if (!thread || !msg?.changes) return
    const targets = msg.changes.filter((c) => !c.reverted && (!path || c.path === path))
    const restored = new Set<string>()
    for (const c of targets) {
      try {
        if (c.before === null) {
          if ((await api.workspace.exists(c.path)) === 'file') await api.workspace.trash(c.path)
        } else await writeFileContent(c.path, c.before)
        restored.add(c.path)
      } catch (err) {
        toast(`Could not restore ${c.path}: ${(err as Error).message}`, 'error')
      }
    }
    patchMessage(thread.id, messageId, (m) => ({
      ...m,
      changes: (m.changes ?? []).map((c) => (restored.has(c.path) ? { ...c, reverted: true } : c))
    }))
    if (restored.size) toast(restored.size === 1 ? `Restored ${basename([...restored][0])}` : `Restored ${restored.size} files`, 'success')
  }
}))

function patchThread(threadId: string, fn: (t: ChatThread) => ChatThread): void {
  useChat.setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? fn(t) : t)) }))
}

function patchMessage(threadId: string, messageId: string, fn: (m: ChatMessage) => ChatMessage): void {
  patchThread(threadId, (t) => ({ ...t, updatedAt: Date.now(), messages: t.messages.map((m) => (m.id === messageId ? fn(m) : m)) }))
}

function getMessage(threadId: string, messageId: string): ChatMessage | undefined {
  return useChat
    .getState()
    .threads.find((t) => t.id === threadId)
    ?.messages.find((m) => m.id === messageId)
}

const CONTEXT_FILE_LIMIT = 24000

async function withContext(text: string, chips: ContextChip[]): Promise<string> {
  if (!chips.length) return text
  const blocks: string[] = []
  for (const chip of chips) {
    if (chip.kind === 'selection' && chip.text !== undefined) {
      blocks.push(`<selection path="${chip.path}" lines="${chip.startLine}-${chip.endLine}">\n${chip.text}\n</selection>`)
      continue
    }
    let content = openText(chip.path)
    if (content === null) {
      try {
        const f = await api.workspace.readFile(chip.path)
        content = f.binary ? '[binary file]' : f.tooLarge ? '[file too large to attach]' : f.content
      } catch {
        content = '[could not read this file]'
      }
    }
    if (content.length > CONTEXT_FILE_LIMIT) content = content.slice(0, CONTEXT_FILE_LIMIT) + '\n[cut: the file continues; use read_file for the rest]'
    blocks.push(`<file path="${chip.path}">\n${content}\n</file>`)
  }
  return `${blocks.join('\n\n')}\n\n${text}`
}

// Context window management: rough token estimate, trim old tool output first.

function estimateTokens(messages: LlmMessage[]): number {
  let chars = 0
  for (const m of messages) {
    chars += m.content.length + 16
    for (const c of m.toolCalls ?? []) chars += JSON.stringify(c.arguments).length + c.name.length
  }
  return Math.ceil(chars / 3.4)
}

function fitToWindow(messages: LlmMessage[], budget: number): LlmMessage[] {
  const out = messages.map((m) => ({ ...m }))
  if (estimateTokens(out) <= budget) return out
  // 1. Shorten old tool results, oldest first, keeping the latest few intact.
  const toolIdx = out.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0)
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - 3))) {
    if (out[i].content.length > 300) out[i].content = out[i].content.slice(0, 200) + '\n[older output removed to save space]'
    if (estimateTokens(out) <= budget) return out
  }
  // 2. Drop the oldest exchanges, keeping the system prompt and the current turn.
  const lastUser = out.map((m) => m.role).lastIndexOf('user')
  let firstKeep = 1
  while (estimateTokens([out[0], ...out.slice(firstKeep)]) > budget && firstKeep < lastUser) {
    firstKeep++
    while (firstKeep < lastUser && out[firstKeep].role !== 'user') firstKeep++
  }
  return [out[0], ...out.slice(firstKeep)]
}

function history(thread: ChatThread, currentId: string): LlmMessage[] {
  const out: LlmMessage[] = []
  for (const m of thread.messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.llmContent ?? m.text ?? '' })
      continue
    }
    if (m.transcript?.length) out.push(...m.transcript)
    else if (m.id !== currentId) {
      const text = (m.parts ?? [])
        .filter((p): p is Extract<AssistantPart, { kind: 'text' }> => p.kind === 'text')
        .map((p) => p.text)
        .join('')
      if (text) out.push({ role: 'assistant', content: text })
    }
    const reverted = (m.changes ?? []).filter((c) => c.reverted).map((c) => c.path)
    if (reverted.length && m.id !== currentId) out.push({ role: 'user', content: `(Note: I reverted your changes to ${reverted.join(', ')}.)` })
  }
  return out
}

interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  stats?: GenStats
  error?: string
  /** The model got stuck repeating the same text and was stopped. */
  looped?: boolean
}


function streamOnce(
  threadId: string,
  messageId: string,
  request: Parameters<typeof api.llm.chat>[1]
): Promise<StreamResult> {
  return new Promise((resolve) => {
    const requestId = uid('chat')
    currentRequest = requestId
    let content = ''
    let toolCalls: ToolCall[] = []
    let pendingText = ''
    let pendingThinking = ''
    let frame = 0
    let tokens = 0
    let watched = ''
    let nextCheck = 2400
    let looped = false
    const startedAt = Date.now()
    useModels.setState({ activity: 'waiting', activityModel: request.modelId, liveTokens: 0 })

    const flush = () => {
      frame = 0
      if (!pendingText && !pendingThinking) return
      const text = pendingText
      const thinking = pendingThinking
      pendingText = ''
      pendingThinking = ''
      patchMessage(threadId, messageId, (m) => {
        const parts = [...(m.parts ?? [])]
        if (thinking) {
          const last = parts[parts.length - 1]
          if (last?.kind === 'thinking' && !last.endedAt) parts[parts.length - 1] = { ...last, text: last.text + thinking }
          else parts.push({ kind: 'thinking', text: thinking, startedAt: Date.now() })
        }
        if (text) {
          const last = parts[parts.length - 1]
          if (last?.kind === 'thinking' && !last.endedAt) parts[parts.length - 1] = { ...last, endedAt: Date.now() }
          const tail = parts[parts.length - 1]
          if (tail?.kind === 'text') parts[parts.length - 1] = { ...tail, text: tail.text + text }
          else parts.push({ kind: 'text', text })
        }
        return { ...m, parts }
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush)
    }

    const off = api.llm.onChatEvent(requestId, (e: ChatEvent) => {
      if (e.type === 'content' || e.type === 'thinking') {
        tokens++
        const elapsed = (Date.now() - startedAt) / 1000
        useModels.setState({ activity: 'streaming', liveTokens: elapsed > 0.5 ? tokens / elapsed : 0 })
        if (e.type === 'content') {
          content += e.text
          pendingText += e.text
        } else pendingThinking += e.text
        schedule()
        watched += e.text
        if (!looped && watched.length >= nextCheck) {
          nextCheck = watched.length + 600
          if (isLooping(watched)) {
            looped = true
            api.llm.abort(requestId)
          }
        }
      } else if (e.type === 'tool_calls') {
        toolCalls = [...toolCalls, ...e.calls]
      } else if (e.type === 'done' || e.type === 'error') {
        if (frame) cancelAnimationFrame(frame)
        flush()
        patchMessage(threadId, messageId, (m) => ({
          ...m,
          parts: (m.parts ?? []).map((p) => (p.kind === 'thinking' && !p.endedAt ? { ...p, endedAt: Date.now() } : p))
        }))
        off()
        resolve({ content, toolCalls, stats: e.type === 'done' ? e.stats : undefined, error: e.type === 'error' ? e.message : undefined, looped })
      }
    })
    api.llm.chat(requestId, request)
  })
}

async function runTurn(threadId: string, messageId: string): Promise<void> {
  const settings = settingsNow()
  const msg = getMessage(threadId, messageId)!
  const modelId = msg.modelId!
  const mode = msg.mode ?? 'agent'
  const toolsEnabled = supportsTools(modelId)
  const tools: ToolSpec[] | undefined = toolsEnabled ? TOOL_SPECS.filter((t) => mode === 'agent' || READ_ONLY_TOOLS.has(t.name)) : undefined
  const allowed = new Set((tools ?? []).map((t) => t.name))
  const system = await buildSystemPrompt(mode, toolsEnabled)
  const model = modelById(modelId)
  const contextWindow = settings.contextWindow
  let think = supportsThinking(modelId) ? settings.showThinking : undefined
  let retriedLoop = false
  // Order of the last command run and the last file change, to catch "fixed it, never re-ran the tests".
  let lastCommandAt = -1
  let lastChangeAt = -1
  let toolIndex = 0
  let nudged = false

  if (!toolsEnabled && mode === 'agent') {
    patchMessage(threadId, messageId, (m) => ({
      ...m,
      parts: [
        ...(m.parts ?? []),
        { kind: 'notice', text: `${shortModelName(model?.name)} cannot use tools, so it can only answer from the context you attach. Pick a model with tool support to let it read and edit files.` }
      ]
    }))
  }

  // Files whose content the model has in front of it: attached ones, then whatever it reads.
  const seen = new Set<string>((getMessage(threadId, messageId) ? userChipsBefore(threadId, messageId) : []).map((c) => c.path))
  let totalStats: GenStats | undefined
  for (let step = 0; step < settings.agent.maxSteps; step++) {
    if (stopped) break
    const thread = useChat.getState().threads.find((t) => t.id === threadId)
    if (!thread) return
    const budget = Math.max(2048, Math.floor(contextWindow * 0.85) - 1500)
    const messages = fitToWindow([{ role: 'system', content: system }, ...history(thread, messageId)], budget)

    const result = await streamOnce(threadId, messageId, {
      modelId,
      messages,
      tools,
      temperature: settings.temperature ?? undefined,
      contextWindow,
      keepAlive: settings.keepAlive,
      think
    })
    if (result.stats) {
      totalStats = {
        promptTokens: result.stats.promptTokens,
        outputTokens: (totalStats?.outputTokens ?? 0) + (result.stats.outputTokens ?? 0),
        tokensPerSecond: result.stats.tokensPerSecond ?? totalStats?.tokensPerSecond,
        durationMs: (totalStats?.durationMs ?? 0) + (result.stats.durationMs ?? 0),
        loadMs: totalStats?.loadMs ?? result.stats.loadMs
      }
      patchMessage(threadId, messageId, (m) => ({ ...m, stats: totalStats }))
      useModels.setState({ lastStats: { ...result.stats, modelId } })
    }
    if (result.looped && !stopped) {
      const retry = !retriedLoop
      patchMessage(threadId, messageId, (m) => ({
        ...m,
        parts: [
          ...(m.parts ?? []),
          {
            kind: 'notice',
            text: retry
              ? 'The model started repeating itself, so Hearth stopped it and asked again' + (think ? ' without extended reasoning.' : '.')
              : 'The model kept repeating itself, so Hearth stopped. Try rephrasing, or a different model.'
          }
        ]
      }))
      if (!retry) return
      retriedLoop = true
      if (think) think = false
      continue
    }
    if (result.error) {
      patchMessage(threadId, messageId, (m) => ({ ...m, error: result.error }))
      return
    }

    let content = result.content
    let calls = result.toolCalls
    if (!calls.length && tools) {
      const recovered = extractToolCalls(content, TOOL_NAMES)
      if (recovered.calls.length) {
        calls = recovered.calls
        content = recovered.rest
        replaceLastText(threadId, messageId, recovered.rest)
      }
    }
    appendTranscript(threadId, messageId, { role: 'assistant', content, toolCalls: calls.length ? calls : undefined })
    if (!calls.length && !stopped && !nudged && lastCommandAt >= 0 && lastChangeAt > lastCommandAt && step < settings.agent.maxSteps - 1) {
      nudged = true
      patchMessage(threadId, messageId, (m) => ({
        ...m,
        parts: [...(m.parts ?? []), { kind: 'notice', text: 'Files changed after the last command, so Hearth asked the model to run its check again.' }]
      }))
      appendTranscript(threadId, messageId, {
        role: 'user',
        content: 'You changed files after the last command you ran. Run the relevant command again (tests, build or linter) to check your changes, fix anything that fails, then give your summary.'
      })
      continue
    }
    if (!calls.length || stopped) {
      if (stopped && calls.length) for (const c of calls) appendTranscript(threadId, messageId, toolMessage(c, 'Stopped by the user.'))
      break
    }

    for (const call of calls) {
      if (stopped) {
        appendTranscript(threadId, messageId, toolMessage(call, 'Stopped by the user before this ran.'))
        continue
      }
      const resultText = await runTool(threadId, messageId, call, allowed, seen)
      appendTranscript(threadId, messageId, toolMessage(call, resultText))
      toolIndex++
      if (call.name === 'run_command' && resultText.startsWith('Exit code')) lastCommandAt = toolIndex
      if (/^(Edited|Created|Replaced|Moved) /.test(resultText)) lastChangeAt = toolIndex
    }
    if (step === settings.agent.maxSteps - 1) {
      patchMessage(threadId, messageId, (m) => ({
        ...m,
        parts: [...(m.parts ?? []), { kind: 'notice', text: `Paused after ${settings.agent.maxSteps} steps. Send "continue" to let it keep going.` }]
      }))
    }
  }
}

function toolMessage(call: ToolCall, content: string): LlmMessage {
  return { role: 'tool', content, toolCallId: call.id, toolName: call.name }
}

function appendTranscript(threadId: string, messageId: string, entry: LlmMessage): void {
  patchMessage(threadId, messageId, (m) => ({ ...m, transcript: [...(m.transcript ?? []), entry] }))
}

function replaceLastText(threadId: string, messageId: string, text: string): void {
  patchMessage(threadId, messageId, (m) => {
    const parts = [...(m.parts ?? [])]
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].kind === 'text') {
        if (text.trim()) parts[i] = { kind: 'text', text }
        else parts.splice(i, 1)
        break
      }
    }
    return { ...m, parts }
  })
}

function patchStep(threadId: string, messageId: string, stepId: string, patch: Partial<ToolStep>): void {
  patchMessage(threadId, messageId, (m) => ({
    ...m,
    parts: (m.parts ?? []).map((p) => (p.kind === 'tool' && p.step.id === stepId ? { ...p, step: { ...p.step, ...patch } } : p))
  }))
}

function userChipsBefore(threadId: string, messageId: string): ContextChip[] {
  const thread = useChat.getState().threads.find((t) => t.id === threadId)
  if (!thread) return []
  const i = thread.messages.findIndex((m) => m.id === messageId)
  const user = i > 0 ? thread.messages[i - 1] : undefined
  return (user?.chips ?? []).filter((c) => c.kind === 'file')
}

async function runTool(threadId: string, messageId: string, call: ToolCall, allowed: Set<string>, seen: Set<string>): Promise<string> {
  const stepId = uid('step')
  const step: ToolStep = { id: stepId, name: call.name, args: call.arguments, status: 'running', startedAt: Date.now(), ...describeCall(call) }
  patchMessage(threadId, messageId, (m) => ({ ...m, parts: [...(m.parts ?? []), { kind: 'tool', step }] }))
  if (!allowed.has(call.name)) {
    const why = READ_ONLY_TOOLS.has(call.name) || !TOOL_NAMES.includes(call.name) ? `There is no tool called ${call.name}.` : `${call.name} is not available in Ask mode. Describe the change instead.`
    patchStep(threadId, messageId, stepId, { status: 'error', error: why, endedAt: Date.now() })
    return why
  }
  try {
    const result = await executeTool(call, {
      seen,
      update: (patch) => patchStep(threadId, messageId, stepId, patch),
      requestApproval: () =>
        new Promise<Decision>((resolve) => {
          patchStep(threadId, messageId, stepId, { status: 'awaiting' })
          approvals.set(stepId, (d) => {
            patchStep(threadId, messageId, stepId, { status: d.approved ? 'running' : 'declined' })
            resolve(d)
          })
        }),
      isStopped: () => stopped,
      recordChange: (path, before, after) => recordChange(threadId, messageId, path, before, after),
      setRunning: (id) => {
        currentExec = id
      }
    })
    const latest = getMessage(threadId, messageId)
    const s = latest?.parts?.find((p) => p.kind === 'tool' && p.step.id === stepId)
    const status = s && s.kind === 'tool' && s.step.status === 'declined' ? 'declined' : 'done'
    patchStep(threadId, messageId, stepId, { status, endedAt: Date.now() })
    return result
  } catch (err) {
    const message = (err as Error).message || String(err)
    patchStep(threadId, messageId, stepId, { status: 'error', error: message, endedAt: Date.now() })
    return `Error: ${message}`
  }
}

function recordChange(threadId: string, messageId: string, path: string, before: string | null, after: string | null): void {
  patchMessage(threadId, messageId, (m) => {
    const changes: FileChange[] = [...(m.changes ?? [])]
    const i = changes.findIndex((c) => c.path === path)
    if (i >= 0) changes[i] = { ...changes[i], after, reverted: false }
    else changes.push({ path, before, after })
    return { ...m, changes }
  })
}
