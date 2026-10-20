// App state: one small store that main-process events and the UI both write to.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SETTINGS,
  EMPTY_USAGE,
  type AgentEvent,
  type ConfigureOptions,
  type Effort,
  type AppInfo,
  type FileChange,
  type FileRef,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type QueuedMessage,
  type RewindMode,
  type SessionData,
  type SessionMeta,
  type Settings,
  type SlashCommand,
  type TranscriptItem,
  type WorkspaceInfo,
} from '../shared/types'
import { api } from './api'

export interface ChatState {
  session: SessionData
  changes: FileChange[]
  permission: PermissionRequest | null
  /** Messages typed while the agent works, waiting for its next step. */
  queue: QueuedMessage[]
}

export type SettingsSection = 'connection' | 'model' | 'permissions' | 'appearance'

export interface AppState {
  ready: boolean
  settings: Settings
  hasApiKey: boolean
  app: AppInfo
  workspace: WorkspaceInfo | null
  /** Conversations in every project, most recently used first. */
  sessions: SessionMeta[]
  /** When each conversation was last opened for work; the list sorts and groups by it, so it never reshuffles on its own. */
  activeAt: Record<string, number>
  /** The selected conversation; null with chatId set means it is still loading. */
  chatId: string | null
  chat: ChatState | null
  view: 'chat' | 'settings'
  settingsSection: SettingsSection | null
  showChanges: boolean
  showSidebar: boolean
  selectedFile: string | null
  /** Which view the right-hand panel shows. */
  panelTab: 'changes' | 'files'
  /** The file open in the files view, or null for the file list. */
  viewedFile: string | null
  /** Files and lines pointed at for the next message. */
  refs: FileRef[]
  /** Model and permissions for the next new conversation. */
  draft: { model: string; effort: Effort; permissionMode: PermissionMode }
  /** Bumped to ask the composer to take focus. */
  focusTick: number
  /** Text to put in the composer, such as a message taken back by rewinding; `tick` makes each one new. */
  fill: { text: string; append: boolean; tick: number } | null
  /** The project's own slash commands. */
  commands: SlashCommand[]
  /** Files in the open folder, for the @ picker; null until first asked for. */
  files: string[] | null
  /** The message the rewind dialog is open for, or '' to pick one. */
  rewindFor: string | null
}

const PREFS_KEY = 'dsh.ui'

type Prefs = { showChanges?: boolean; showSidebar?: boolean }

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...prefs }))
  } catch {
    // Private windows can refuse storage; the panel just opens with its default next time.
  }
}

let state: AppState = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  hasApiKey: false,
  app: { platform: 'darwin', version: '0.0.0', keyEncryption: true, home: '' },
  workspace: null,
  sessions: [],
  activeAt: {},
  chatId: null,
  chat: null,
  view: 'chat',
  settingsSection: null,
  showChanges: readPrefs().showChanges ?? false,
  showSidebar: readPrefs().showSidebar ?? true,
  selectedFile: null,
  panelTab: 'changes',
  viewedFile: null,
  refs: [],
  draft: { model: DEFAULT_SETTINGS.model, effort: DEFAULT_SETTINGS.effort, permissionMode: DEFAULT_SETTINGS.permissionMode },
  focusTick: 0,
  fill: null,
  commands: [],
  files: null,
  rewindFor: null,
}

const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Selectors must return something already in the state (or a primitive), never a fresh object. */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

// ── conversation helpers ───────────────────────────────────────

function metaOf(session: SessionData): SessionMeta {
  const { items: _items, usage: _usage, ...meta } = session
  return meta
}

function upsertItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].id === item.id) {
      const next = items.slice()
      next[i] = item
      return next
    }
  }
  return [...items, item]
}

/** Updates a conversation in the list without moving it, so the sidebar does not shuffle while agents work. */
function placeMeta(sessions: SessionMeta[], meta: SessionMeta, moveToTop: boolean): SessionMeta[] {
  const index = sessions.findIndex((s) => s.id === meta.id)
  if (index === -1) return [meta, ...sessions]
  if (moveToTop) return [meta, ...sessions.slice(0, index), ...sessions.slice(index + 1)]
  const next = sessions.slice()
  next[index] = meta
  return next
}

function updateChat(sessionId: string, fn: (chat: ChatState) => Partial<ChatState>) {
  set((s) => (s.chat && s.chat.session.id === sessionId ? { chat: { ...s.chat, ...fn(s.chat) } } : {}))
}

function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case 'item':
      updateChat(event.sessionId, (chat) => ({ session: { ...chat.session, items: upsertItem(chat.session.items, event.item) } }))
      break
    case 'remove':
      updateChat(event.sessionId, (chat) => ({
        session: { ...chat.session, items: chat.session.items.filter((item) => item.id !== event.itemId) },
      }))
      break
    case 'meta':
      set((s) => ({
        sessions: placeMeta(s.sessions, event.meta, false),
        activeAt: event.meta.id in s.activeAt ? s.activeAt : { ...s.activeAt, [event.meta.id]: event.meta.updatedAt },
        chat: s.chat && s.chat.session.id === event.meta.id ? { ...s.chat, session: { ...s.chat.session, ...event.meta } } : s.chat,
      }))
      break
    case 'permission':
      updateChat(event.sessionId, () => ({ permission: event.request }))
      break
    case 'changes':
      updateChat(event.sessionId, () => ({ changes: event.changes }))
      set((s) => {
        if (!s.chat || s.chat.session.id !== event.sessionId) return {}
        const paths = event.changes.map((c) => c.path)
        const selectedFile = s.selectedFile && paths.includes(s.selectedFile) ? s.selectedFile : (paths[0] ?? null)
        return selectedFile === s.selectedFile ? {} : { selectedFile }
      })
      break
    case 'todos':
      updateChat(event.sessionId, (chat) => ({ session: { ...chat.session, todos: event.todos.length ? event.todos : undefined } }))
      break
    case 'queue':
      updateChat(event.sessionId, () => ({ queue: event.queue }))
      break
    case 'usage':
      updateChat(event.sessionId, (chat) => ({ session: { ...chat.session, usage: event.usage } }))
      break
    case 'settings': {
      const projectsChanged = event.settings.projects.join('\n') !== state.settings.projects.join('\n')
      set({ settings: event.settings, hasApiKey: event.hasApiKey })
      if (projectsChanged) void loadSessions()
      break
    }
    case 'workspace':
      if (event.workspace?.path !== state.workspace?.path) switchedTo(event.workspace)
      else set({ workspace: event.workspace })
      break
  }
}

/** Folder-specific state starts over in a new folder; a conversation that belongs to it stays open. */
function switchedTo(workspace: WorkspaceInfo | null) {
  set((s) => ({
    workspace,
    ...(s.chat && s.chat.session.workspace !== workspace?.path ? { chatId: null, chat: null } : {}),
    selectedFile: null,
    viewedFile: null,
    refs: [],
    commands: [],
    files: null,
  }))
  void loadCommands()
}

/** Projects in the sidebar: the saved list, plus the open folder if it is somehow not on it. */
export function projectPaths(projects: string[], workspace: WorkspaceInfo | null): string[] {
  return workspace && !projects.includes(workspace.path) ? [workspace.path, ...projects] : projects
}

let loadSeq = 0
async function loadSessions() {
  const seq = ++loadSeq
  const lists = await Promise.all(projectPaths(state.settings.projects, state.workspace).map((path) => api.sessions.list(path)))
  if (seq !== loadSeq) return
  const sessions = lists.flat().sort((a, b) => b.updatedAt - a.updatedAt)
  set((s) => ({
    sessions,
    activeAt: { ...Object.fromEntries(sessions.map((m) => [m.id, m.updatedAt])), ...s.activeAt },
  }))
}

async function loadCommands() {
  const workspace = state.workspace
  if (!workspace) return
  const commands = await api.workspace.commands()
  if (state.workspace?.path === workspace.path) set({ commands })
}

// ── actions ────────────────────────────────────────────────────

export const actions = {
  async init() {
    api.onEvent(handleEvent)
    const initial = await api.getInitialState()
    set({
      ready: true,
      settings: initial.settings,
      hasApiKey: initial.hasApiKey,
      app: initial.app,
      workspace: initial.workspace,
      draft: { model: initial.settings.model, effort: initial.settings.effort, permissionMode: initial.settings.permissionMode },
    })
    await Promise.all([loadSessions(), loadCommands()])
  },

  /** A new conversation, in the given project or the open one. */
  async newChat(project?: string) {
    if (project && project !== state.workspace?.path && !(await actions.openWorkspace(project))) return
    set((s) => ({
      view: 'chat',
      chatId: null,
      chat: null,
      selectedFile: null,
      draft: { model: s.settings.model, effort: s.settings.effort, permissionMode: s.settings.permissionMode },
      focusTick: s.focusTick + 1,
    }))
  },

  async openSession(id: string) {
    if (state.chatId === id && state.view === 'chat') return
    // A conversation in another project opens that project first.
    const meta = state.sessions.find((m) => m.id === id)
    if (meta && meta.workspace !== state.workspace?.path && !(await actions.openWorkspace(meta.workspace))) return
    // Events for this conversation are ignored until the snapshot arrives; the snapshot already contains them.
    set({ view: 'chat', chatId: id, chat: null, selectedFile: null })
    const snapshot = await api.sessions.load(id)
    if (state.chatId !== id) return
    if (!snapshot) {
      set((s) => ({ chatId: null, sessions: s.sessions.filter((m) => m.id !== id) }))
      return
    }
    set((s) => ({
      chat: { session: snapshot.session, changes: snapshot.changes, permission: snapshot.permission, queue: snapshot.queue ?? [] },
      selectedFile: snapshot.changes[0]?.path ?? null,
      focusTick: s.focusTick + 1,
    }))
  },

  async send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const { chat, chatId, workspace, draft, refs } = state
    // A conversation is still loading; sending now would start a new one by mistake.
    if (!chat && chatId) return
    if (chat) {
      if (chat.permission) {
        // Typing while the agent waits means "no, do this instead".
        await actions.respond({ type: 'deny', feedback: trimmed })
        return
      }
      set((s) => ({
        sessions: placeMeta(s.sessions, metaOf(chat.session), true),
        activeAt: { ...s.activeAt, [chat.session.id]: Date.now() },
      }))
      set({ refs: [] })
      await api.agent.send(chat.session.id, trimmed, refs)
      return
    }
    if (!workspace) return
    const now = Date.now()
    const id = crypto.randomUUID()
    const session: SessionData = {
      id,
      title: trimmed.split('\n')[0].slice(0, 40),
      workspace: workspace.path,
      createdAt: now,
      updatedAt: now,
      model: draft.model,
      effort: draft.effort,
      permissionMode: draft.permissionMode,
      status: 'running',
      items: [],
      usage: { ...EMPTY_USAGE },
    }
    set((s) => ({
      chatId: id,
      chat: { session, changes: [], permission: null, queue: [] },
      sessions: placeMeta(s.sessions, metaOf(session), true),
      activeAt: { ...s.activeAt, [id]: now },
    }))
    set({ refs: [] })
    await api.agent.start(workspace.path, trimmed, { id, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode }, refs)
  },

  /** Stopping also takes back queued messages and puts them in the composer, as Claude Code does. */
  async stop() {
    const chat = state.chat
    if (!chat) return
    if (chat.queue.length) {
      const taken = await api.agent.unqueue(chat.session.id)
      if (taken.length) actions.fillComposer(taken.map((m) => m.text).join('\n\n'), true)
    }
    void api.agent.stop(chat.session.id)
  },

  async unqueue(messageId: string) {
    const chat = state.chat
    if (!chat) return
    updateChat(chat.session.id, (c) => ({ queue: c.queue.filter((m) => m.id !== messageId) }))
    await api.agent.unqueue(chat.session.id, messageId)
  },

  /** Puts text in the composer; `append` keeps what is already typed in front of it. */
  fillComposer(text: string, append = false) {
    set((s) => ({ fill: { text, append, tick: (s.fill?.tick ?? 0) + 1 }, focusTick: s.focusTick + 1 }))
  },

  openRewind(itemId = '') {
    set({ rewindFor: itemId })
  },

  closeRewind() {
    set((s) => ({ rewindFor: null, focusTick: s.focusTick + 1 }))
  },

  async rewind(itemId: string, mode: RewindMode) {
    const chat = state.chat
    if (!chat) return { ok: false as const, error: 'no-session' }
    const result = await api.agent.rewind(chat.session.id, itemId, mode)
    if (!result.ok) return result
    if (mode !== 'code') {
      const snapshot = await api.sessions.load(chat.session.id)
      if (snapshot && state.chat?.session.id === chat.session.id) {
        set({ chat: { session: snapshot.session, changes: snapshot.changes, permission: snapshot.permission, queue: snapshot.queue ?? [] } })
      }
      // The message goes back in the composer so it can be changed and sent again.
      set({ refs: result.refs ?? [] })
      actions.fillComposer(result.text)
    }
    return result
  },

  /** Loads the folder's files for the @ picker, once per folder. */
  async loadFiles() {
    if (state.files !== null || !state.workspace) return
    const path = state.workspace.path
    set({ files: [] })
    const list = await api.workspace.files()
    if (state.workspace?.path === path) set({ files: list.files })
  },

  reloadCommands() {
    void loadCommands()
  },

  retry() {
    if (state.chat) void api.agent.retry(state.chat.session.id)
  },

  compact(focus?: string) {
    if (state.chat) void api.agent.compact(state.chat.session.id, focus)
  },

  async respond(decision: PermissionDecision) {
    const chat = state.chat
    if (!chat?.permission) return
    const request = chat.permission
    // Hide the prompt right away; the main process confirms with its own event.
    updateChat(chat.session.id, () => ({ permission: null }))
    await api.agent.respond(chat.session.id, request.id, decision)
  },

  async configure(opts: ConfigureOptions) {
    const chat = state.chat
    if (!chat) {
      set((s) => ({ draft: { ...s.draft, ...opts } }))
      return
    }
    updateChat(chat.session.id, (c) => ({ session: { ...c.session, ...opts } }))
    await api.agent.configure(chat.session.id, opts)
  },

  async removeSession(id: string) {
    await api.sessions.remove(id)
    set((s) => ({
      sessions: s.sessions.filter((m) => m.id !== id),
      ...(s.chatId === id ? { chatId: null, chat: null, selectedFile: null } : {}),
    }))
  },

  async revertAll() {
    if (state.chat) await api.changes.revertAll(state.chat.session.id)
  },

  async commit(message: string) {
    if (!state.chat) return { ok: false, error: 'no-session' }
    return api.changes.commit(state.chat.session.id, message)
  },

  async pickWorkspace() {
    await api.workspace.pick()
  },

  /** Opens a project folder. Returns false when the folder is gone, and drops it from the lists. */
  async openWorkspace(path: string): Promise<boolean> {
    const info = await api.workspace.open(path)
    if (!info) {
      const { recentWorkspaces, projects } = state.settings
      await api.settings.update({ recentWorkspaces: recentWorkspaces.filter((p) => p !== path), projects: projects.filter((p) => p !== path) })
      return false
    }
    if (info.path !== state.workspace?.path) switchedTo(info)
    return true
  },

  /** Takes a project off the sidebar. Its folder and conversations stay on disk. */
  async removeProject(path: string) {
    await api.settings.update({ projects: state.settings.projects.filter((p) => p !== path) })
  },

  toggleSidebar() {
    const next = !state.showSidebar
    writePrefs({ showSidebar: next })
    set({ showSidebar: next })
  },

  toggleChanges(show?: boolean) {
    const next = show ?? !state.showChanges
    writePrefs({ showChanges: next })
    set({ showChanges: next })
  },

  selectFile(path: string) {
    writePrefs({ showChanges: true })
    set({ selectedFile: path, showChanges: true, panelTab: 'changes' })
  },

  setPanelTab(tab: AppState['panelTab']) {
    set({ panelTab: tab })
  },

  viewFile(path: string | null) {
    writePrefs({ showChanges: true })
    set({ viewedFile: path, panelTab: 'files', showChanges: true })
  },

  /** Points at a file or some of its lines for the next message; the same range twice is kept once. */
  addRef(ref: FileRef) {
    set((s) => {
      const same = (r: FileRef) => r.path === ref.path && r.start === ref.start && r.end === ref.end
      return { refs: s.refs.some(same) ? s.refs : [...s.refs, ref], focusTick: s.focusTick + 1 }
    })
  },

  removeRef(index: number) {
    set((s) => ({ refs: s.refs.filter((_, i) => i !== index) }))
  },

  openSettings(section: SettingsSection | null = null) {
    set({ view: 'settings', settingsSection: section })
  },

  closeSettings() {
    set((s) => ({ view: 'chat', settingsSection: null, focusTick: s.focusTick + 1 }))
  },
}
