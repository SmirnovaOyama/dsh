// Types shared by the main process, the preload bridge and the renderer.

/** `plan` only reads and searches, then shows a plan to approve before anything changes. */
export type PermissionMode = 'ask' | 'acceptEdits' | 'auto' | 'plan'
export const PERMISSION_MODES: PermissionMode[] = ['ask', 'acceptEdits', 'auto', 'plan']
export type ThemePref = 'system' | 'light' | 'dark'
export type Locale = 'zh-Hant' | 'en'
export type ReplyStyle = 'precise' | 'balanced' | 'varied'

/** The model ids DeepSeek's API takes, from https://api-docs.deepseek.com/quick_start/pricing */
export const MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const
export type ModelId = (typeof MODELS)[number]

/** How long the model thinks before answering. `none` turns thinking off. */
export const EFFORTS = ['none', 'low', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface ModelInfo {
  /** "DeepSeek V4.1 Flash" */
  name: string
  /** What the composer button shows: "V4.1 Flash" */
  short: string
  /** The version the id points to today, as DeepSeek's docs name it. */
  version: string
  /** Input and output together, in tokens. */
  contextWindow: number
}

export const MODEL_INFO: Record<ModelId, ModelInfo> = {
  'deepseek-flash': { name: 'DeepSeek V4.1 Flash', short: 'V4.1 Flash', version: 'DeepSeek-V4.1-Flash-1017', contextWindow: 1_000_000 },
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', short: 'V4 Pro', version: 'DeepSeek-V4-Pro-0813', contextWindow: 1_000_000 },
}

export function modelInfo(model: string): ModelInfo | null {
  return (MODEL_INFO as Record<string, ModelInfo | undefined>)[model] ?? null
}

/** A model id someone typed in by hand still gets a window, the smallest DeepSeek has offered lately. */
export function contextWindow(model: string): number {
  return modelInfo(model)?.contextWindow ?? 128_000
}

/**
 * Names DeepSeek has retired, mapped to what they point to now. `deepseek-chat` and
 * `deepseek-reasoner` were V4 Flash without and with thinking, so the choice someone made is kept.
 */
const LEGACY: Record<string, { model: ModelId; effort?: Effort }> = {
  'deepseek-chat': { model: 'deepseek-flash', effort: 'none' },
  'deepseek-reasoner': { model: 'deepseek-flash', effort: 'high' },
  'deepseek-v4-flash': { model: 'deepseek-flash' },
  'deepseek-v4-flash-vision-exp': { model: 'deepseek-flash' },
}

export const DEFAULT_EFFORT: Effort = 'high'

export function currentModel(model: string, effort: Effort | undefined): { model: string; effort: Effort } {
  const legacy = LEGACY[model]
  if (legacy) return { model: legacy.model, effort: legacy.effort ?? effort ?? DEFAULT_EFFORT }
  return { model, effort: effort && (EFFORTS as readonly string[]).includes(effort) ? effort : DEFAULT_EFFORT }
}
export const MAX_STEPS_OPTIONS = [20, 50, 100, 200] as const

export interface Settings {
  baseUrl: string
  model: string
  effort: Effort
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
  effort: Effort
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
  | {
      kind: 'user'
      id: string
      text: string
      at: number
      refs?: FileRef[]
      /** The conversation was summarised after this message, so only code can be rewound to it. */
      compacted?: boolean
      /** The custom command it started with, such as `review`. */
      command?: string
    }
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
  /** The agent's own to-do list for the task, as it last wrote it. */
  todos?: Todo[]
}

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** A message typed while the agent works. It goes to the agent at the next step. */
export interface QueuedMessage {
  id: string
  text: string
  refs?: FileRef[]
}

/** What to put back when rewinding to a message. */
export type RewindMode = 'both' | 'conversation' | 'code'

export type RewindResult = { ok: true; text: string; refs?: FileRef[]; restored: number } | { ok: false; error: string }

/** A command from the project's .dsh/commands (or .claude/commands) folder. */
export interface SlashCommand {
  name: string
  description: string
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
  kind: 'edit' | 'command' | 'plan'
  /** The plan to approve, in Markdown. */
  plan?: string
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
  | { type: 'allow'; mode?: PermissionMode }
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
  | { type: 'todos'; sessionId: string; todos: Todo[] }
  | { type: 'queue'; sessionId: string; queue: QueuedMessage[] }

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
  queue: QueuedMessage[]
}

export interface StartOptions {
  id: string
  model: string
  effort: Effort
  permissionMode: PermissionMode
}

export type ConfigureOptions = { model?: string; effort?: Effort; permissionMode?: PermissionMode }

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
    /** Custom slash commands in the open folder. */
    commands(): Promise<SlashCommand[]>
  }
  sessions: {
    list(workspace: string): Promise<SessionMeta[]>
    load(id: string): Promise<SessionSnapshot | null>
    remove(id: string): Promise<void>
  }
  agent: {
    /** The renderer picks the id, so it can show the conversation before the first event arrives. */
    start(workspace: string, text: string, opts: StartOptions, refs?: FileRef[]): Promise<SessionMeta>
    /** While the agent works, the message waits in a queue and goes in at its next step. */
    send(sessionId: string, text: string, refs?: FileRef[]): Promise<void>
    /** Takes queued messages back, all of them or one; returns what was taken. */
    unqueue(sessionId: string, messageId?: string): Promise<QueuedMessage[]>
    /** Goes back to just before a message of the person's, in the conversation, the files or both. */
    rewind(sessionId: string, itemId: string, mode: RewindMode): Promise<RewindResult>
    stop(sessionId: string): Promise<void>
    retry(sessionId: string): Promise<void>
    /** Replaces the conversation the model sees with a summary, keeping the transcript on screen. */
    compact(sessionId: string, focus?: string): Promise<void>
    respond(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>
    configure(sessionId: string, opts: ConfigureOptions): Promise<SessionMeta | null>
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
  model: 'deepseek-flash',
  effort: DEFAULT_EFFORT,
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
