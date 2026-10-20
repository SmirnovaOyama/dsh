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
  type LibraryArtifact,
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
import { anyArtifacts, isArtifact, type ArtifactItem } from './artifacts'

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
  view: 'chat' | 'settings' | 'artifacts'
  settingsSection: SettingsSection | null
  /** The page Settings goes back to. */
  settingsFrom: 'chat' | 'artifacts'
  showChanges: boolean
  selectedFile: string | null
  /** Which view the right-hand panel shows. */
  panelTab: 'changes' | 'files' | 'artifacts'
  /** The transcript item holding the artifact version open in the panel, or null for the list. */
  viewedArtifact: string | null
  /** The panel as it was before an artifact took it over, so closing the artifact puts it back. */
  panelBefore: { show: boolean; tab: 'changes' | 'files' } | null
  /** The file open in the files view, or null for the file list. */
  viewedFile: string | null
  /** Files and lines pointed at for the next message. */
  refs: FileRef[]
  /** Model and permissions for the next new conversation. */
  draft: { model: string; effort: Effort; permissionMode: PermissionMode }
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
  settingsFrom: 'chat',
  showChanges: readPrefs().showChanges ?? false,
  selectedFile: null,
  panelTab: 'changes',
  viewedArtifact: null,
  panelBefore: null,
  viewedFile: null,
  refs: [],
  draft: { model: DEFAULT_SETTINGS.model, effort: DEFAULT_SETTINGS.effort, permissionMode: DEFAULT_SETTINGS.permissionMode },
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

/**
 * A version that never got finished leaves the panel for the newest one that did. A first version that
 * was stopped stays, so the person can see what got written; one that failed has nothing to show.
 */
function leaveUnfinished(item: ArtifactItem) {
  const items = state.chat?.session.items ?? []
  const done = items.filter((i): i is ArtifactItem => isArtifact(i) && i.status === 'done' && i.artifact.id === item.artifact.id)
  const newest = done.reduce<ArtifactItem | null>((best, i) => (!best || i.artifact.version >= best.artifact.version ? i : best), null)
  if (newest) actions.viewArtifact(newest.id)
  else if (item.status === 'stopped') return
  else if (anyArtifacts(items)) actions.viewArtifact(null)
  else actions.closeArtifacts()
}

/** Leaving a conversation leaves its artifacts: the panel goes back to what it showed before one opened. */
function leaveArtifacts(s: AppState): Partial<AppState> {
  if (s.panelTab !== 'artifacts') return { viewedArtifact: null, panelBefore: null }
  const before = s.panelBefore
  return { viewedArtifact: null, panelBefore: null, panelTab: before?.tab ?? 'changes', showChanges: before ? before.show : s.showChanges }
}

function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case 'item': {
      const item = event.item
      const isNew = state.chat?.session.id === event.sessionId && !state.chat.session.items.some((i) => i.id === item.id)
      updateChat(event.sessionId, (chat) => ({ session: { ...chat.session, items: upsertItem(chat.session.items, item) } }))
      // A new artifact opens beside the chat as the agent starts writing it, as it does in Claude.
      if (isNew && item.kind === 'tool' && item.artifact && item.status === 'running') actions.viewArtifact(item.id)
      const showing = state.showChanges && state.panelTab === 'artifacts' && state.viewedArtifact === item.id
      if (isArtifact(item) && (item.status === 'error' || item.status === 'stopped') && showing) leaveUnfinished(item)
      break
    }
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
        set((s) => ({ chatId: null, chat: null, sessions: [], activeAt: {}, selectedFile: null, viewedFile: null, refs: [], ...leaveArtifacts(s) }))
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
      draft: { model: initial.settings.model, effort: initial.settings.effort, permissionMode: initial.settings.permissionMode },
    })
    await loadSessions()
  },

  newChat() {
    set((s) => ({
      view: 'chat',
      chatId: null,
      chat: null,
      selectedFile: null,
      ...leaveArtifacts(s),
      draft: { model: s.settings.model, effort: s.settings.effort, permissionMode: s.settings.permissionMode },
      focusTick: s.focusTick + 1,
    }))
  },

  /** Opens a conversation. Says whether it opened, was gone, or was left for something opened after it. */
  async openSession(id: string): Promise<'opened' | 'missing' | 'superseded'> {
    if (state.chatId === id && state.view === 'chat') return state.chat ? 'opened' : 'superseded'
    // Coming back from a page to the conversation already loaded keeps it as it was.
    if (state.chatId === id && state.chat) {
      set({ view: 'chat' })
      return 'opened'
    }
    // Events for this conversation are ignored until the snapshot arrives; the snapshot already contains them.
    set((s) => ({ view: 'chat', chatId: id, chat: null, selectedFile: null, ...leaveArtifacts(s) }))
    const snapshot = await api.sessions.load(id)
    if (state.chatId !== id) return 'superseded'
    if (!snapshot) {
      set((s) => ({ chatId: null, sessions: s.sessions.filter((m) => m.id !== id) }))
      return 'missing'
    }
    set((s) => ({
      chat: { session: snapshot.session, changes: snapshot.changes, permission: snapshot.permission },
      selectedFile: snapshot.changes[0]?.path ?? null,
      focusTick: s.focusTick + 1,
    }))
    return 'opened'
  },

  /** Sends a message. Pointed-at files go with it, unless the message comes from somewhere other than the composer. */
  async send(text: string, opts: { withRefs?: boolean } = {}) {
    const trimmed = text.trim()
    if (!trimmed) return
    const withRefs = opts.withRefs ?? true
    const { chat, chatId, workspace, draft } = state
    const refs = withRefs ? state.refs : []
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
      if (withRefs) set({ refs: [] })
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
      chat: { session, changes: [], permission: null },
      sessions: placeMeta(s.sessions, metaOf(session), true),
      activeAt: { ...s.activeAt, [id]: now },
    }))
    if (withRefs) set({ refs: [] })
    await api.agent.start(workspace.path, trimmed, { id, model: draft.model, effort: draft.effort, permissionMode: draft.permissionMode }, refs)
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
      ...(s.chatId === id ? { chatId: null, chat: null, selectedFile: null, ...leaveArtifacts(s) } : {}),
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
    // The panel button always brings back changes and files; artifacts open from their own places.
    if (state.showChanges && state.panelTab === 'artifacts' && show !== false) {
      writePrefs({ showChanges: true })
      set({ panelTab: 'changes', panelBefore: null })
      return
    }
    const next = show ?? !state.showChanges
    writePrefs({ showChanges: next })
    set((s) => ({ showChanges: next, panelTab: s.panelTab === 'artifacts' && next ? 'changes' : s.panelTab, panelBefore: null }))
  },

  /**
   * Closes an artifact, or the list of them. The panel goes back to what it showed before, or closes
   * if it was closed; while it closes it keeps showing the artifact, so nothing swaps as it fades.
   */
  closeArtifacts() {
    const before = state.panelBefore
    if (before?.show) set({ panelTab: before.tab, panelBefore: null })
    else set({ showChanges: false, panelBefore: null })
  },

  selectFile(path: string) {
    writePrefs({ showChanges: true })
    set({ selectedFile: path, showChanges: true, panelTab: 'changes' })
  },

  setPanelTab(tab: AppState['panelTab']) {
    set({ panelTab: tab })
  },

  /** Opens one artifact version in the panel by its transcript item, or the list with null. */
  viewArtifact(itemId: string | null) {
    set((s) => ({
      viewedArtifact: itemId,
      panelTab: 'artifacts',
      showChanges: true,
      panelBefore: s.showChanges && s.panelTab === 'artifacts' ? s.panelBefore : { show: s.showChanges, tab: s.panelTab === 'artifacts' ? 'changes' : s.panelTab },
    }))
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

  /** The page listing every artifact in every folder. */
  openLibrary() {
    set({ view: 'artifacts' })
  },

  /**
   * Opens an artifact from the library where it was made: its folder, its conversation, and the viewer
   * beside it. When the folder or the conversation is gone, nothing changes and the reason comes back.
   */
  async openArtifact(entry: LibraryArtifact): Promise<'opened' | 'folder' | 'conversation' | 'superseded'> {
    const stillHere = () => state.view === 'artifacts'
    if (!(await api.sessions.load(entry.sessionId))) return 'conversation'
    if (!stillHere()) return 'superseded'
    if (state.workspace?.path !== entry.workspace) {
      const info = await api.workspace.open(entry.workspace)
      if (!info) return 'folder'
      // The folder's own event may come before or after this; whichever is second changes nothing.
      handleEvent({ type: 'workspace', workspace: info })
      if (!stillHere()) return 'superseded'
    }
    const outcome = await actions.openSession(entry.sessionId)
    if (outcome === 'missing') {
      // Gone in the moment since the check: back to the library, which no longer lists it.
      set({ view: 'artifacts' })
      return 'conversation'
    }
    if (outcome !== 'opened' || state.chat?.session.id !== entry.sessionId) return 'superseded'
    const item = state.chat.session.items.find((i) => i.id === entry.itemId)
    actions.viewArtifact(item ? entry.itemId : null)
    return 'opened'
  },

  openSettings(section: SettingsSection | null = null) {
    set((s) => ({ view: 'settings', settingsSection: section, settingsFrom: s.view === 'settings' ? s.settingsFrom : s.view }))
  },

  closeSettings() {
    set((s) => ({ view: s.settingsFrom, settingsSection: null, focusTick: s.focusTick + 1 }))
  },
}
