// App state: one small store that main-process events and the UI both write to.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SETTINGS,
  EMPTY_USAGE,
  type AgentEvent,
  type AppInfo,
  type FileChange,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type SessionData,
  type SessionMeta,
  type Settings,
  type TranscriptItem,
  type WorkspaceInfo,
} from '../shared/types'
import { api } from './api'

export interface ChatState {
  session: SessionData
  changes: FileChange[]
  permission: PermissionRequest | null
}

export type SettingsSection = 'connection' | 'model' | 'permissions' | 'appearance'

export interface AppState {
  ready: boolean
  settings: Settings
  hasApiKey: boolean
  app: AppInfo
  workspace: WorkspaceInfo | null
  /** Conversations in this folder, most recently used first. */
  sessions: SessionMeta[]
  /** When each conversation was last opened for work; the list sorts and groups by it, so it never reshuffles on its own. */
  activeAt: Record<string, number>
  /** The selected conversation; null with chatId set means it is still loading. */
  chatId: string | null
  chat: ChatState | null
  view: 'chat' | 'settings'
  settingsSection: SettingsSection | null
  showChanges: boolean
  selectedFile: string | null
  /** Model and permissions for the next new conversation. */
  draft: { model: string; permissionMode: PermissionMode }
  /** Bumped to ask the composer to take focus. */
  focusTick: number
}

const PREFS_KEY = 'dsh.ui'

function readPrefs(): { showChanges?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writePrefs(prefs: { showChanges: boolean }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
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
  selectedFile: null,
  draft: { model: DEFAULT_SETTINGS.model, permissionMode: DEFAULT_SETTINGS.permissionMode },
  focusTick: 0,
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
        sessions: s.workspace && event.meta.workspace === s.workspace.path ? placeMeta(s.sessions, event.meta, false) : s.sessions,
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
    case 'usage':
      updateChat(event.sessionId, (chat) => ({ session: { ...chat.session, usage: event.usage } }))
      break
    case 'settings':
      set({ settings: event.settings, hasApiKey: event.hasApiKey })
      break
    case 'workspace': {
      const changed = event.workspace?.path !== state.workspace?.path
      set({ workspace: event.workspace })
      if (changed) {
        set({ chatId: null, chat: null, sessions: [], activeAt: {}, selectedFile: null })
        void loadSessions()
      }
      break
    }
  }
}

async function loadSessions() {
  const workspace = state.workspace
  if (!workspace) return
  const sessions = await api.sessions.list(workspace.path)
  if (state.workspace?.path !== workspace.path) return
  set({
    sessions: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    activeAt: Object.fromEntries(sessions.map((m) => [m.id, m.updatedAt])),
  })
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
      draft: { model: initial.settings.model, permissionMode: initial.settings.permissionMode },
    })
    await loadSessions()
  },

  newChat() {
    set((s) => ({
      view: 'chat',
      chatId: null,
      chat: null,
      selectedFile: null,
      draft: { model: s.settings.model, permissionMode: s.settings.permissionMode },
      focusTick: s.focusTick + 1,
    }))
  },

  async openSession(id: string) {
    if (state.chatId === id && state.view === 'chat') return
    // Events for this conversation are ignored until the snapshot arrives; the snapshot already contains them.
    set({ view: 'chat', chatId: id, chat: null, selectedFile: null })
    const snapshot = await api.sessions.load(id)
    if (state.chatId !== id) return
    if (!snapshot) {
      set((s) => ({ chatId: null, sessions: s.sessions.filter((m) => m.id !== id) }))
      return
    }
    set((s) => ({
      chat: { session: snapshot.session, changes: snapshot.changes, permission: snapshot.permission },
      selectedFile: snapshot.changes[0]?.path ?? null,
      focusTick: s.focusTick + 1,
    }))
  },

  async send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const { chat, chatId, workspace, draft } = state
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
      await api.agent.send(chat.session.id, trimmed)
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
      permissionMode: draft.permissionMode,
      status: 'running',
      items: [],
      usage: { ...EMPTY_USAGE },
    }
    set((s) => ({
      chatId: id,
      chat: { session, changes: [], permission: null },
      sessions: placeMeta(s.sessions, metaOf(session), true),
      activeAt: { ...s.activeAt, [id]: now },
    }))
    await api.agent.start(workspace.path, trimmed, { id, model: draft.model, permissionMode: draft.permissionMode })
  },

  stop() {
    if (state.chat) void api.agent.stop(state.chat.session.id)
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

  async configure(opts: { model?: string; permissionMode?: PermissionMode }) {
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

  async openWorkspace(path: string) {
    const info = await api.workspace.open(path)
    if (!info) {
      // The folder is gone; drop it from the recent list.
      const recent = state.settings.recentWorkspaces.filter((p) => p !== path)
      await api.settings.update({ recentWorkspaces: recent })
    }
  },

  toggleChanges(show?: boolean) {
    const next = show ?? !state.showChanges
    writePrefs({ showChanges: next })
    set({ showChanges: next })
  },

  selectFile(path: string) {
    writePrefs({ showChanges: true })
    set({ selectedFile: path, showChanges: true })
  },

  openSettings(section: SettingsSection | null = null) {
    set({ view: 'settings', settingsSection: section })
  },

  closeSettings() {
    set((s) => ({ view: 'chat', settingsSection: null, focusTick: s.focusTick + 1 }))
  },
}
