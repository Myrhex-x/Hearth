// Types shared by the main process, the preload bridge and the renderer.

export type Platform = 'darwin' | 'win32' | 'linux'

export interface AppInfo {
  version: string
  platform: Platform
  /** Windows build number (22000 and up is Windows 11), 0 elsewhere. */
  windowsBuild: number
  arch: string
  osName: string
  shell: string
  shellName: string
  home: string
  isDev: boolean
}

// Models and providers

export type ProviderKind = 'ollama' | 'openai'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  apiKey?: string
  enabled: boolean
}

export interface ProviderStatus {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  ok: boolean
  version?: string
  error?: string
}

export type ModelCapability = 'tools' | 'insert' | 'thinking' | 'vision' | 'completion'

export interface ModelInfo {
  /** `${providerId}::${name}` */
  id: string
  providerId: string
  providerName: string
  providerKind: ProviderKind
  name: string
  sizeBytes?: number
  parameterSize?: string
  family?: string
  quantization?: string
  /** Undefined means the server does not report capabilities. */
  capabilities?: ModelCapability[]
  contextLength?: number
}

export interface LoadedModel {
  id: string
  providerId: string
  name: string
  sizeBytes: number
  vramBytes: number
  expiresAt?: string
  contextLength?: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
}

export interface ChatRequest {
  modelId: string
  messages: LlmMessage[]
  tools?: ToolSpec[]
  temperature?: number
  contextWindow?: number
  keepAlive?: string
  /** true or false sends the flag, undefined leaves the server default. */
  think?: boolean
  maxTokens?: number
}

export interface GenStats {
  promptTokens?: number
  outputTokens?: number
  tokensPerSecond?: number
  durationMs?: number
  loadMs?: number
}

export type ChatEvent =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'done'; stats?: GenStats }
  | { type: 'error'; message: string }

export interface CompletionRequest {
  modelId: string
  prefix: string
  suffix: string
  maxTokens: number
  temperature?: number
  stop?: string[]
  keepAlive?: string
}

export interface PullProgress {
  status: string
  completed?: number
  total?: number
  done?: boolean
  error?: string
}

// Workspace

export interface WorkspaceInfo {
  root: string
  name: string
}

export interface RecentWorkspace {
  root: string
  name: string
  openedAt: number
}

export interface DirEntry {
  name: string
  /** Path relative to the workspace root, always with forward slashes. */
  path: string
  kind: 'file' | 'dir'
  ignored?: boolean
}

export interface FileContent {
  path: string
  content: string
  binary: boolean
  tooLarge: boolean
  bom: boolean
  /** Files saved by Windows tools are sometimes UTF-16; they are written back the same way. */
  encoding?: 'utf8' | 'utf16le'
  size: number
  mtimeMs: number
  /** data: URL for images that the editor can preview. */
  imageDataUrl?: string
}

export interface SearchOptions {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Only search under this folder (relative path). */
  under?: string
  maxResults?: number
}

export interface SearchMatch {
  path: string
  line: number
  column: number
  length: number
  text: string
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
  filesSearched: number
  error?: string
}

export interface WriteOptions {
  bom?: boolean
  encoding?: 'utf8' | 'utf16le'
}

export interface ExecResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  truncated: boolean
  aborted: boolean
}

export interface ContextMenuItem {
  id?: string
  label?: string
  accelerator?: string
  enabled?: boolean
  type?: 'separator'
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}

// Settings

export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePref
  providers: ProviderConfig[]
  chatModel: string | null
  inlineEditModel: string | null
  autocompleteModel: string | null
  autocompleteEnabled: boolean
  contextWindow: number
  /** null keeps each model's own recommended sampling settings. */
  temperature: number | null
  keepAlive: string
  showThinking: boolean
  agent: {
    autoApplyEdits: boolean
    autoRunCommands: boolean
    maxSteps: number
  }
  editor: {
    fontSize: number
    tabSize: number
    wordWrap: boolean
    minimap: boolean
    lineNumbers: boolean
  }
  terminal: {
    fontSize: number
  }
  layout: {
    sidebarVisible: boolean
    chatVisible: boolean
    terminalVisible: boolean
    sidebarWidth: number
    chatWidth: number
    terminalHeight: number
  }
  recent: RecentWorkspace[]
  lastWorkspace: string | null
  onboarded: boolean
}

export type SettingsPatch = Partial<Omit<Settings, 'agent' | 'editor' | 'terminal' | 'layout'>> & {
  agent?: Partial<Settings['agent']>
  editor?: Partial<Settings['editor']>
  terminal?: Partial<Settings['terminal']>
  layout?: Partial<Settings['layout']>
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'ollama', kind: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434', enabled: true },
  { id: 'lmstudio', kind: 'openai', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', enabled: true },
  { id: 'llamacpp', kind: 'openai', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', enabled: false }
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  providers: DEFAULT_PROVIDERS,
  chatModel: null,
  inlineEditModel: null,
  autocompleteModel: null,
  autocompleteEnabled: true,
  contextWindow: 16384,
  temperature: null,
  keepAlive: '30m',
  showThinking: true,
  agent: { autoApplyEdits: true, autoRunCommands: false, maxSteps: 24 },
  editor: { fontSize: 13, tabSize: 2, wordWrap: false, minimap: false, lineNumbers: true },
  terminal: { fontSize: 12 },
  layout: {
    sidebarVisible: true,
    chatVisible: true,
    terminalVisible: false,
    sidebarWidth: 248,
    chatWidth: 400,
    terminalHeight: 240
  },
  recent: [],
  lastWorkspace: null,
  onboarded: false
}

export function modelIdOf(providerId: string, name: string): string {
  return `${providerId}::${name}`
}

export function splitModelId(id: string): { providerId: string; name: string } {
  const at = id.indexOf('::')
  if (at < 0) return { providerId: 'ollama', name: id }
  return { providerId: id.slice(0, at), name: id.slice(at + 2) }
}
