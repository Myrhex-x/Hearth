import type { GenStats, LlmMessage } from '../../../shared/types'

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: string[]
}

export interface DiffInfo {
  added: number
  removed: number
  hunks: DiffHunk[]
  truncated?: boolean
}

export type StepStatus = 'running' | 'awaiting' | 'done' | 'error' | 'declined' | 'stopped'

export interface ToolStep {
  id: string
  name: string
  args: Record<string, unknown>
  status: StepStatus
  title: string
  detail?: string
  path?: string
  diff?: DiffInfo
  command?: string
  output?: string
  exitCode?: number | null
  error?: string
  startedAt: number
  endedAt?: number
}

export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; startedAt: number; endedAt?: number }
  | { kind: 'tool'; step: ToolStep }
  | { kind: 'notice'; text: string }

export interface ContextChip {
  kind: 'file' | 'selection'
  path: string
  startLine?: number
  endLine?: number
  text?: string
}

export interface FileChange {
  path: string
  /** null when the file did not exist before the turn. */
  before: string | null
  after: string | null
  reverted?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  text?: string
  chips?: ContextChip[]
  /** What the model actually received for this user message, context included. */
  llmContent?: string
  parts?: AssistantPart[]
  modelId?: string
  mode?: 'agent' | 'ask'
  stats?: GenStats
  error?: string
  done?: boolean
  transcript?: LlmMessage[]
  changes?: FileChange[]
  /** Roughly how much of the model's context window the latest request filled. */
  context?: { used: number; limit: number }
}

export interface ChatThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}
