// Owns the open conversations: loads and saves them, runs the agent, and holds pending permission prompts.
// Nothing here depends on Electron, so it can be tested in plain Node.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  currentModel,
  EMPTY_USAGE,
  type ConfigureOptions,
  type AgentEvent,
  type CommitResult,
  type FileRef,
  type LibraryArtifact,
  type PermissionDecision,
  type PermissionRequest,
  type SessionMeta,
  type SessionSnapshot,
  type StartOptions,
  type WorkspaceInfo,
} from '../shared/types'
import { Agent, type AgentHost, type SessionState } from './agent'
import { artifactsIn, byNewest } from '../shared/library'
import { ChangeTracker } from './changes'
import type { streamChat } from './deepseek'
import { buildSystemPrompt } from './prompt'
import { metaOf, type SessionStore, type SettingsStore } from './store'
import { shellFor } from './tools/shell'

const run = promisify(execFile)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function readWorkspace(dir: string): Promise<WorkspaceInfo> {
  const info: WorkspaceInfo = { path: dir, name: path.basename(dir) || dir, branch: null, isGitRepo: false }
  try {
    const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 5_000 })
    info.isGitRepo = stdout.trim() === 'true'
  } catch {
    return info
  }
  try {
    const { stdout } = await run('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir, timeout: 5_000 })
    info.branch = stdout.trim() || null
  } catch {
    try {
      const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, timeout: 5_000 })
      info.branch = stdout.trim() || null
    } catch {
      info.branch = null
    }
  }
  return info
}

export interface ControllerOptions {
  settings: SettingsStore
  sessions: SessionStore
  emit(event: AgentEvent): void
  chat?: typeof streamChat
  now?: () => number
}

interface Pending {
  request: PermissionRequest
  resolve(decision: PermissionDecision): void
}

export class Controller {
  private readonly states = new Map<string, SessionState>()
  private readonly pending = new Map<string, Pending>()
  /** Artifacts of conversations read from disk, kept until the conversation changes. */
  private readonly library = new Map<string, { updatedAt: number; artifacts: LibraryArtifact[] }>()
  private readonly agent: Agent
  private readonly now: () => number

  constructor(private readonly options: ControllerOptions) {
    this.now = options.now ?? Date.now
    const host: AgentHost = {
      settings: () => options.settings.get(),
      apiKey: () => options.settings.apiKey(),
      emit: (event) => options.emit(event),
      persist: (state) => this.persist(state),
      systemPrompt: (state) => this.systemPrompt(state),
      askPermission: (state, need, toolItemId, signal) => this.askPermission(state, need, toolItemId, signal),
      allowCommandAlways: (prefix) => void this.allowAlways(prefix),
      changesUpdated: (state) => void this.emitChanges(state),
      chat: options.chat,
      now: this.now,
    }
    this.agent = new Agent(host)
  }

  async open(id: string): Promise<SessionState | null> {
    const existing = this.states.get(id)
    if (existing) return existing
    const stored = await this.options.sessions.read(id)
    if (!stored) return null
    // A conversation saved while it was running is idle once the app restarts.
    const items = stored.data.items.map((item) =>
      item.kind === 'tool' && (item.status === 'running' || item.status === 'waiting')
        ? { ...item, status: 'stopped' as const, queued: undefined }
        : item.kind === 'text' && item.streaming
          ? { ...item, streaming: false }
          : item,
    )
    const state: SessionState = {
      data: { ...stored.data, ...currentModel(stored.data.model, stored.data.effort), items, status: 'idle' },
      messages: stored.messages,
      tracker: new ChangeTracker(stored.data.workspace, stored.snapshots),
      allowEdits: stored.allowEdits,
      allowedPrefixes: stored.allowedPrefixes,
      controller: null,
    }
    this.states.set(id, state)
    return state
  }

  async snapshot(id: string): Promise<SessionSnapshot | null> {
    const state = await this.open(id)
    if (!state) return null
    // Copy the conversation after the last await, so no event can land between the copy and the reply.
    const changes = await state.tracker.list()
    return {
      session: { ...state.data, items: [...state.data.items], usage: { ...state.data.usage } },
      changes,
      permission: this.pending.get(id)?.request ?? null,
    }
  }

  /** Every finished artifact in every folder, newest first. Open conversations are read as they are now. */
  async artifacts(): Promise<LibraryArtifact[]> {
    const all: LibraryArtifact[] = []
    for (const meta of this.options.sessions.all()) {
      const live = this.states.get(meta.id)
      if (live) {
        all.push(...artifactsIn(live.data))
        continue
      }
      let cached = this.library.get(meta.id)
      if (cached?.updatedAt !== meta.updatedAt) {
        const stored = await this.options.sessions.read(meta.id)
        cached = { updatedAt: meta.updatedAt, artifacts: stored ? artifactsIn(stored.data) : [] }
        this.library.set(meta.id, cached)
      }
      all.push(...cached.artifacts)
    }
    return all.sort(byNewest)
  }

  async start(workspace: string, text: string, opts: StartOptions, refs: FileRef[] = []): Promise<SessionMeta> {
    const now = this.now()
    const id = UUID.test(opts.id) && !this.states.has(opts.id) ? opts.id : randomUUID()
    const state: SessionState = {
      data: {
        id,
        title: '',
        workspace,
        createdAt: now,
        updatedAt: now,
        ...currentModel(opts.model, opts.effort),
        permissionMode: opts.permissionMode,
        status: 'idle',
        items: [],
        usage: { ...EMPTY_USAGE },
      },
      messages: [],
      tracker: new ChangeTracker(workspace),
      allowEdits: false,
      allowedPrefixes: [],
      controller: null,
    }
    this.states.set(state.data.id, state)
    void this.agent.send(state, text, refs)
    return metaOf(state.data)
  }

  async send(id: string, text: string, refs: FileRef[] = []): Promise<void> {
    const state = await this.open(id)
    if (state) void this.agent.send(state, text, refs)
  }

  async retry(id: string): Promise<void> {
    const state = await this.open(id)
    if (state) void this.agent.resume(state)
  }

  async compact(id: string, focus?: string): Promise<void> {
    const state = await this.open(id)
    if (state) void this.agent.compact(state, focus)
  }

  stop(id: string): void {
    const state = this.states.get(id)
    if (state) this.agent.stop(state)
  }

  respond(id: string, requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(id)
    if (!pending || pending.request.id !== requestId) return
    this.pending.delete(id)
    this.options.emit({ type: 'permission', sessionId: id, request: null })
    pending.resolve(decision)
  }

  async configure(id: string, opts: ConfigureOptions): Promise<SessionMeta | null> {
    const state = await this.open(id)
    if (!state) return null
    if (opts.model || opts.effort) Object.assign(state.data, currentModel(opts.model ?? state.data.model, opts.effort ?? state.data.effort))
    if (opts.permissionMode) state.data.permissionMode = opts.permissionMode
    this.persist(state)
    const meta = metaOf(state.data)
    this.options.emit({ type: 'meta', meta })
    return meta
  }

  async revertAll(id: string): Promise<void> {
    const state = await this.open(id)
    if (!state || this.agent.isRunning(state)) return
    await state.tracker.revertAll()
    this.persist(state)
    await this.emitChanges(state)
  }

  async commit(id: string, message: string): Promise<CommitResult> {
    const state = await this.open(id)
    if (!state) return { ok: false, error: 'not-found' }
    const paths = (await state.tracker.list()).map((change) => change.path)
    if (!paths.length) return { ok: false, error: 'nothing' }
    try {
      const cwd = state.data.workspace
      await run('git', ['add', '-A', '--', ...paths], { cwd, timeout: 30_000 })
      await run('git', ['commit', '-m', message.trim() || state.data.title, '--', ...paths], { cwd, timeout: 60_000 })
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr
      return { ok: false, error: (stderr || (error as Error).message).trim().slice(0, 500) }
    }
    state.tracker.clear()
    this.persist(state)
    await this.emitChanges(state)
    return { ok: true }
  }

  async remove(id: string): Promise<void> {
    const state = this.states.get(id)
    if (state) this.agent.stop(state)
    this.states.delete(id)
    this.library.delete(id)
    await this.options.sessions.remove(id)
  }

  stopAll(): void {
    for (const state of this.states.values()) this.agent.stop(state)
  }

  private persist(state: SessionState): void {
    this.options.sessions.save({
      version: 1,
      data: state.data,
      messages: state.messages,
      snapshots: state.tracker.toJSON(),
      allowEdits: state.allowEdits,
      allowedPrefixes: state.allowedPrefixes,
    })
  }

  private async systemPrompt(state: SessionState): Promise<string> {
    const workspace = await readWorkspace(state.data.workspace)
    const settings = this.options.settings.get()
    return buildSystemPrompt({
      workspace: state.data.workspace,
      branch: workspace.branch,
      platform: process.platform,
      shell: shellFor().file,
      locale: settings.locale,
      today: new Date(this.now()).toISOString().slice(0, 10),
    })
  }

  private askPermission(
    state: SessionState,
    need: Parameters<AgentHost['askPermission']>[1],
    toolItemId: string,
    signal: AbortSignal,
  ): Promise<PermissionDecision> {
    const sessionId = state.data.id
    const request: PermissionRequest =
      need.kind === 'edit'
        ? { id: randomUUID(), sessionId, toolItemId, kind: 'edit', path: need.path, created: need.created, stats: need.stats, lines: need.lines }
        : { id: randomUUID(), sessionId, toolItemId, kind: 'command', command: need.command, cwd: need.cwd, prefix: need.prefix }
    return new Promise((resolve) => {
      const onAbort = () => this.respond(sessionId, request.id, { type: 'deny' })
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(sessionId, {
        request,
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort)
          resolve(decision)
        },
      })
      this.options.emit({ type: 'permission', sessionId, request })
    })
  }

  private async allowAlways(prefix: string): Promise<void> {
    const settings = this.options.settings.get()
    if (settings.allowedCommands.includes(prefix)) return
    const next = await this.options.settings.update({ allowedCommands: [...settings.allowedCommands, prefix] })
    this.options.emit({ type: 'settings', settings: next, hasApiKey: this.options.settings.hasApiKey() })
  }

  private async emitChanges(state: SessionState): Promise<void> {
    this.options.emit({ type: 'changes', sessionId: state.data.id, changes: await state.tracker.list() })
  }
}
