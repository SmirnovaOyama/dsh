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

/**
 * Who answers a model's requests. DeepSeek's own models keep their bare ids; a model from OpenCode
 * is `opencode/<id>`, the way OpenCode itself names them.
 */
export type Provider = 'deepseek' | 'opencode'
export const PROVIDERS: Provider[] = ['deepseek', 'opencode']
const OPENCODE_PREFIX = 'opencode/'

export function providerOf(model: string): Provider {
  return model.startsWith(OPENCODE_PREFIX) ? 'opencode' : 'deepseek'
}

/** The id the provider's API takes: `opencode/glm-5.3` is `glm-5.3` to OpenCode. */
export function apiModel(model: string): string {
  return providerOf(model) === 'opencode' ? model.slice(OPENCODE_PREFIX.length) : model
}

export function opencodeModel(id: string): string {
  return OPENCODE_PREFIX + id
}

/** OpenCode's two ways to pay, each at an address of its own: the Go subscription, or credits used as you go. */
export type OpenCodePlan = 'go' | 'paygo'
export const OPENCODE_PLANS: OpenCodePlan[] = ['go', 'paygo']
export const OPENCODE_BASE_URLS: Record<OpenCodePlan, string> = {
  go: 'https://opencode.ai/inference/go/v1',
  paygo: 'https://opencode.ai/inference/v1',
}

/** OpenCode's free models answer only OpenCode itself, so the menus leave them out. */
export function usableOpenCodeModel(id: string): boolean {
  return !id.endsWith('-free') && id !== 'big-pickle'
}

/** The model a new conversation starts on when OpenCode is the only key: DeepSeek's own default, when the plan has it. */
export function defaultOpenCodeModel(ids: string[]): string | null {
  const id = ids.includes('deepseek-v4.1-flash') ? 'deepseek-v4.1-flash' : ids[0]
  return id ? opencodeModel(id) : null
}

/** OpenCode's names for DeepSeek's models, which have the same window there. */
const OPENCODE_DEEPSEEK: Record<string, ModelId> = { 'deepseek-v4.1-flash': 'deepseek-flash', 'deepseek-v4-pro': 'deepseek-v4-pro' }

/** A model id someone typed in by hand, or another company's model on OpenCode, still gets a window, the smallest DeepSeek has offered lately. */
export function contextWindow(model: string): number {
  const info = modelInfo(model) ?? (providerOf(model) === 'opencode' ? modelInfo(OPENCODE_DEEPSEEK[apiModel(model)] ?? '') : null)
  return info?.contextWindow ?? 128_000
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
  /** Which OpenCode plan the OpenCode key is for. */
  opencodePlan: OpenCodePlan
  /** The models OpenCode offered the key when last asked, as OpenCode names them. */
  opencodeModels: string[]
  model: string
  effort: Effort
  replyStyle: ReplyStyle
  maxSteps: number
  permissionMode: PermissionMode
  allowedCommands: string[]
  theme: ThemePref
  locale: Locale
  recentWorkspaces: string[]
  /** Folders kept in the sidebar as projects, in the order they were added, newest first. */
  projects: string[]
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

/** Which providers have a key saved. */
export type KeyState = Record<Provider, boolean>

export interface InitialState {
  settings: Settings
  keys: KeyState
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

export type ArtifactType = 'html' | 'react' | 'svg' | 'mermaid' | 'markdown' | 'code'

/** One version of a piece of standalone content the agent made for the person, shown beside the chat. */
export interface ArtifactVersion {
  id: string
  title: string
  type: ArtifactType
  /** The programming language, for code artifacts. */
  language?: string
  content: string
  /** Counts from 1 for each artifact. */
  version: number
}

/** The newest finished version of one artifact, with the conversation and folder it was made in. */
export interface LibraryArtifact {
  sessionId: string
  sessionTitle: string
  workspace: string
  /** The transcript item holding this version, so the viewer can open it. */
  itemId: string
  artifact: ArtifactVersion
  updatedAt: number
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
      /** The artifact tool carries the version it made, so the conversation holds every version. */
      artifact?: ArtifactVersion
      /** An artifact written in full that waits for earlier steps in the same reply before it is made. */
      queued?: boolean
    }
  | { kind: 'error'; id: string; code: ErrorCode; detail?: string; retryable: boolean }
  | { kind: 'notice'; id: string; code: 'max-steps' | 'stopped' | 'length' }
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
  | { type: 'settings'; settings: Settings; keys: KeyState }
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  | { type: 'todos'; sessionId: string; todos: Todo[] }
  | { type: 'queue'; sessionId: string; queue: QueuedMessage[] }
  | { type: 'schedules'; tasks: ScheduledTask[] }

export interface ConnectionResult {
  ok: boolean
  latencyMs?: number
  /** How many models the key can use, when the provider's list says. */
  models?: number
  error?: ErrorCode
}

/** Saving a key checks it first; a key the provider turns down is not kept. */
export interface KeyResult extends ConnectionResult {
  saved: boolean
}

export type SaveResult = { ok: true; path: string } | { ok: false; error: string }

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

/** How often a scheduled task runs. Times are the computer's local time. */
export type ScheduleKind = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly'
export const SCHEDULE_KINDS: ScheduleKind[] = ['manual', 'hourly', 'daily', 'weekdays', 'weekly']

export interface Schedule {
  kind: ScheduleKind
  /** Hour and minute of the day, for daily, weekdays and weekly; only the minute counts for hourly. */
  hour: number
  minute: number
  /** 0 is Sunday, for weekly. */
  weekday: number
}

export interface ScheduledRun {
  at: number
  /** The conversation the run started, or null when it could not start. */
  sessionId: string | null
  error?: string
}

/** A prompt that starts a new conversation in a project on a schedule, while dsh is open. */
export interface ScheduledTask {
  id: string
  name: string
  workspace: string
  prompt: string
  schedule: Schedule
  enabled: boolean
  model: string
  effort: Effort
  permissionMode: PermissionMode
  createdAt: number
  lastRun: ScheduledRun | null
  /** When it runs next, or null when it is off or runs only by hand. */
  nextRun: number | null
}

export type ScheduledTaskInput = Pick<ScheduledTask, 'name' | 'workspace' | 'prompt' | 'schedule' | 'enabled' | 'model' | 'effort' | 'permissionMode'> & {
  id?: string
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
    setApiKey(key: string, provider: Provider): Promise<KeyResult>
    clearApiKey(provider: Provider): Promise<void>
    revealApiKey(provider: Provider): Promise<string | null>
    /** For OpenCode this also refreshes the list of models the key can use. */
    testConnection(provider: Provider): Promise<ConnectionResult>
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
  artifacts: {
    /** Hands a page to the preview frame, served under a policy of its own, and returns the address to load. */
    preview(html: string): Promise<string>
    /** Asks where to save the artifact and writes it there. Resolves null when the person cancels. */
    save(name: string, content: string): Promise<SaveResult | null>
    /** Writes the artifact into the open folder under a name not taken yet. */
    saveToProject(name: string, content: string): Promise<SaveResult>
    /** Opens a page in the person's browser from a private temporary file. */
    openInBrowser(name: string, html: string): Promise<SaveResult>
    /** Every finished artifact in every folder, newest first. */
    library(): Promise<LibraryArtifact[]>
  }
  schedules: {
    list(): Promise<ScheduledTask[]>
    save(task: ScheduledTaskInput): Promise<ScheduledTask | null>
    remove(id: string): Promise<void>
    /** Runs the task now, whatever its schedule; returns the conversation it started. */
    runNow(id: string): Promise<string | null>
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
  opencodePlan: 'go',
  opencodeModels: [],
  model: 'deepseek-flash',
  effort: DEFAULT_EFFORT,
  replyStyle: 'precise',
  maxSteps: 50,
  permissionMode: 'ask',
  allowedCommands: ['git status', 'git diff', 'git log', 'ls', 'pwd', 'npm test', 'npm run test', 'pnpm test', 'yarn test'],
  theme: 'system',
  locale: 'zh-Hant',
  recentWorkspaces: [],
  projects: [],
  lastWorkspace: null,
}

export const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, contextTokens: 0 }
