// Types shared by the main process, the preload bridge and the renderer.

export type PermissionMode = 'ask' | 'acceptEdits' | 'auto'
export type ThemePref = 'system' | 'light' | 'dark'
export type Locale = 'zh-Hant' | 'en'
export type ReplyStyle = 'precise' | 'balanced' | 'varied'

export const MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const
export const CONTEXT_WINDOW = 128_000
export const MAX_STEPS_OPTIONS = [20, 50, 100, 200] as const

export interface Settings {
  baseUrl: string
  model: string
  replyStyle: ReplyStyle
  maxSteps: number
  permissionMode: PermissionMode
  allowedCommands: string[]
  theme: ThemePref
  locale: Locale
  recentWorkspaces: string[]
  lastWorkspace: string | null
}

export interface AppInfo {
  platform: string
  version: string
  /** Whether the API key can be encrypted with the system keychain on this machine. */
  keyEncryption: boolean
  /** The home folder, so paths can be shown as ~/... */
  home: string
}

export interface WorkspaceInfo {
  path: string
  name: string
  branch: string | null
  isGitRepo: boolean
}

export interface InitialState {
  settings: Settings
  hasApiKey: boolean
  app: AppInfo
  workspace: WorkspaceInfo | null
}

export type SessionStatus = 'idle' | 'running' | 'waiting'

export interface SessionMeta {
  id: string
  title: string
  workspace: string
  createdAt: number
  updatedAt: number
  model: string
  permissionMode: PermissionMode
  status: SessionStatus
}

export type ToolStatus = 'waiting' | 'running' | 'done' | 'error' | 'denied' | 'stopped'

export interface DiffStats {
  added: number
  removed: number
}

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del' | 'hunk'
  oldNo?: number
  newNo?: number
  text: string
}

export interface ToolInfo {
  lines?: number
  matches?: number
  files?: number
  exitCode?: number | null
  truncated?: boolean
}

/** A file, or a range of its lines, that the person points the agent at. Lines count from 1. */
export interface FileRef {
  path: string
  start?: number
  end?: number
}

export type FileList = { files: string[]; truncated: boolean }
export type FileRead = { ok: true; text: string } | { ok: false; error: string }

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string; at: number; refs?: FileRef[] }
  | { kind: 'reasoning'; id: string; text: string; startedAt: number; endedAt?: number }
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      callId: string
      name: string
      /** The argument a person reads first: a path, a pattern or a command. */
      target: string
      status: ToolStatus
      startedAt?: number
      endedAt?: number
      output?: string
      error?: string
      info?: ToolInfo
      /** File tools that change a file carry its workspace-relative path and line counts. */
      path?: string
      created?: boolean
      stats?: DiffStats
    }
  | { kind: 'error'; id: string; code: ErrorCode; detail?: string; retryable: boolean }
  | { kind: 'notice'; id: string; code: 'max-steps' | 'stopped' }
  | {
      kind: 'compact'
      id: string
      at: number
      /** Started by the agent because the context was nearly full, rather than by /compact. */
      auto: boolean
      status: 'running' | 'done' | 'failed'
      summary?: string
      detail?: string
      /** How full the context was before compacting. */
      before: number
    }

export type ErrorCode = 'no-key' | 'auth' | 'balance' | 'rate' | 'network' | 'server' | 'bad-request' | 'unknown'

export interface Usage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  /** Prompt size of the latest request, which is how full the context is. */
  contextTokens: number
}

export interface SessionData extends SessionMeta {
  items: TranscriptItem[]
  usage: Usage
}

export interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  stats: DiffStats
  lines: DiffLine[]
}

export interface PermissionRequest {
  id: string
  sessionId: string
  toolItemId: string
  kind: 'edit' | 'command'
  path?: string
  created?: boolean
  stats?: DiffStats
  lines?: DiffLine[]
  command?: string
  cwd?: string
  /** The command prefix offered for "always allow", such as `npm install`. */
  prefix?: string
}

export type PermissionDecision =
  | { type: 'allow' }
  | { type: 'allowSession' }
  | { type: 'allowAlways'; prefix: string }
  | { type: 'deny'; feedback?: string }

export type AgentEvent =
  | { type: 'item'; sessionId: string; item: TranscriptItem }
  | { type: 'remove'; sessionId: string; itemId: string }
  | { type: 'meta'; meta: SessionMeta }
  | { type: 'permission'; sessionId: string; request: PermissionRequest | null }
  | { type: 'changes'; sessionId: string; changes: FileChange[] }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'settings'; settings: Settings; hasApiKey: boolean }
  | { type: 'workspace'; workspace: WorkspaceInfo | null }

export interface ConnectionResult {
  ok: boolean
  latencyMs?: number
  error?: ErrorCode
}

export interface CommitResult {
  ok: boolean
  error?: string
}

export interface SessionSnapshot {
  session: SessionData
  changes: FileChange[]
  permission: PermissionRequest | null
}

export interface StartOptions {
  id: string
  model: string
  permissionMode: PermissionMode
}

export interface DshApi {
  getInitialState(): Promise<InitialState>
  settings: {
    update(patch: Partial<Settings>): Promise<Settings>
    setApiKey(key: string): Promise<void>
    clearApiKey(): Promise<void>
    revealApiKey(): Promise<string | null>
    testConnection(): Promise<ConnectionResult>
  }
  workspace: {
    pick(): Promise<WorkspaceInfo | null>
    open(path: string): Promise<WorkspaceInfo | null>
    /** Files in the open folder, leaving out what .gitignore leaves out. */
    files(): Promise<FileList>
    read(path: string): Promise<FileRead>
  }
  sessions: {
    list(workspace: string): Promise<SessionMeta[]>
    load(id: string): Promise<SessionSnapshot | null>
    remove(id: string): Promise<void>
  }
  agent: {
    /** The renderer picks the id, so it can show the conversation before the first event arrives. */
    start(workspace: string, text: string, opts: StartOptions, refs?: FileRef[]): Promise<SessionMeta>
    send(sessionId: string, text: string, refs?: FileRef[]): Promise<void>
    stop(sessionId: string): Promise<void>
    retry(sessionId: string): Promise<void>
    /** Replaces the conversation the model sees with a summary, keeping the transcript on screen. */
    compact(sessionId: string, focus?: string): Promise<void>
    respond(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
    configure(sessionId: string, opts: { model?: string; permissionMode?: PermissionMode }): Promise<SessionMeta | null>
  }
  changes: {
    revertAll(sessionId: string): Promise<void>
    commit(sessionId: string, message: string): Promise<CommitResult>
  }
  openExternal(url: string): Promise<void>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  replyStyle: 'precise',
  maxSteps: 50,
  permissionMode: 'ask',
  allowedCommands: ['git status', 'git diff', 'git log', 'ls', 'pwd', 'npm test', 'npm run test', 'pnpm test', 'yarn test'],
  theme: 'system',
  locale: 'zh-Hant',
  recentWorkspaces: [],
  lastWorkspace: null,
}

export const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, contextTokens: 0 }
