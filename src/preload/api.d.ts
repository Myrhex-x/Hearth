import type {
  AppInfo,
  ChatEvent,
  ChatRequest,
  CompletionRequest,
  ContextMenuItem,
  DirEntry,
  ExecResult,
  FileContent,
  LoadedModel,
  MessageBoxOptions,
  ModelInfo,
  Platform,
  ProviderStatus,
  PullProgress,
  RecentWorkspace,
  SearchOptions,
  SearchResult,
  Settings,
  SettingsPatch,
  WorkspaceInfo,
  WriteOptions
} from '../shared/types'

type Unsubscribe = () => void

export interface HearthApi {
  platform: Platform
  app: {
    info(): Promise<AppInfo>
    onMenuCommand(cb: (command: string) => void): Unsubscribe
    onCloseRequested(cb: () => void): Unsubscribe
    confirmClose(): void
    cancelClose(): void
    rendererReady(): void
    newWindow(): void
    openExternal(url: string): void
    revealPath(relPath: string): void
    contextMenu(items: ContextMenuItem[]): Promise<string | null>
    messageBox(options: MessageBoxOptions): Promise<number>
    setZoom(level: number): void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
    onChanged(cb: (settings: Settings) => void): Unsubscribe
  }
  workspace: {
    pickFolder(): Promise<WorkspaceInfo | null>
    open(root: string): Promise<WorkspaceInfo>
    close(): Promise<void>
    current(): Promise<WorkspaceInfo | null>
    recent(): Promise<RecentWorkspace[]>
    forgetRecent(root: string): Promise<void>
    listDir(relPath: string): Promise<DirEntry[]>
    listFiles(): Promise<{ files: string[]; truncated: boolean }>
    readFile(relPath: string): Promise<FileContent>
    writeFile(relPath: string, content: string, opts?: WriteOptions): Promise<void>
    canonical(relPath: string): Promise<string>
    exists(relPath: string): Promise<'file' | 'dir' | null>
    createFile(relPath: string): Promise<void>
    createDir(relPath: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    trash(relPath: string): Promise<void>
    search(options: SearchOptions): Promise<SearchResult>
    gitBranch(): Promise<string | null>
    loadState(): Promise<unknown>
    saveState(state: unknown): Promise<void>
    onChanged(cb: (paths: string[]) => void): Unsubscribe
  }
  llm: {
    providerStatus(): Promise<ProviderStatus[]>
    listModels(): Promise<ModelInfo[]>
    loaded(): Promise<LoadedModel[]>
    chat(requestId: string, request: ChatRequest): void
    onChatEvent(requestId: string, cb: (event: ChatEvent) => void): Unsubscribe
    abort(requestId: string): void
    complete(requestId: string, request: CompletionRequest): Promise<string>
    pull(requestId: string, providerId: string, name: string): void
    onPullProgress(requestId: string, cb: (progress: PullProgress) => void): Unsubscribe
    warm(modelId: string, keepAlive: string): Promise<void>
    unload(modelId: string): Promise<void>
  }
  terminal: {
    create(opts: { cols: number; rows: number }): Promise<{ id: string; shell: string } | { error: string }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(id: string, cb: (data: string) => void): Unsubscribe
    onExit(id: string, cb: (code: number) => void): Unsubscribe
  }
  exec: {
    run(requestId: string, command: string, cwdRel?: string): Promise<ExecResult>
    onOutput(requestId: string, cb: (chunk: string) => void): Unsubscribe
    abort(requestId: string): void
  }
}

declare global {
  interface Window {
    hearth: HearthApi
  }
}
