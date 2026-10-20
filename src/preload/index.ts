// Exposes a small, typed API to the renderer. The renderer has no Node or Electron access of its own.

import { contextBridge, ipcRenderer } from 'electron'
import { Channels, EVENT_CHANNEL } from '../shared/ipc'
import type { AgentEvent, DshApi } from '../shared/types'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api: DshApi = {
  getInitialState: invoke(Channels.initialState) as DshApi['getInitialState'],
  settings: {
    update: invoke(Channels.settingsUpdate) as DshApi['settings']['update'],
    setApiKey: invoke(Channels.settingsSetKey) as DshApi['settings']['setApiKey'],
    clearApiKey: invoke(Channels.settingsClearKey) as DshApi['settings']['clearApiKey'],
    revealApiKey: invoke(Channels.settingsRevealKey) as DshApi['settings']['revealApiKey'],
    testConnection: invoke(Channels.settingsTest) as DshApi['settings']['testConnection'],
  },
  workspace: {
    pick: invoke(Channels.workspacePick) as DshApi['workspace']['pick'],
    open: invoke(Channels.workspaceOpen) as DshApi['workspace']['open'],
    files: invoke(Channels.workspaceFiles) as DshApi['workspace']['files'],
    read: invoke(Channels.workspaceRead) as DshApi['workspace']['read'],
    commands: invoke(Channels.workspaceCommands) as DshApi['workspace']['commands'],
  },
  sessions: {
    list: invoke(Channels.sessionsList) as DshApi['sessions']['list'],
    load: invoke(Channels.sessionsLoad) as DshApi['sessions']['load'],
    remove: invoke(Channels.sessionsRemove) as DshApi['sessions']['remove'],
  },
  agent: {
    start: invoke(Channels.agentStart) as DshApi['agent']['start'],
    send: invoke(Channels.agentSend) as DshApi['agent']['send'],
    unqueue: invoke(Channels.agentUnqueue) as DshApi['agent']['unqueue'],
    rewind: invoke(Channels.agentRewind) as DshApi['agent']['rewind'],
    stop: invoke(Channels.agentStop) as DshApi['agent']['stop'],
    retry: invoke(Channels.agentRetry) as DshApi['agent']['retry'],
    compact: invoke(Channels.agentCompact) as DshApi['agent']['compact'],
    respond: invoke(Channels.agentRespond) as DshApi['agent']['respond'],
    configure: invoke(Channels.agentConfigure) as DshApi['agent']['configure'],
  },
  artifacts: {
    preview: invoke(Channels.artifactsPreview) as DshApi['artifacts']['preview'],
    save: invoke(Channels.artifactsSave) as DshApi['artifacts']['save'],
    saveToProject: invoke(Channels.artifactsSaveToProject) as DshApi['artifacts']['saveToProject'],
    openInBrowser: invoke(Channels.artifactsOpenInBrowser) as DshApi['artifacts']['openInBrowser'],
    library: invoke(Channels.artifactsLibrary) as DshApi['artifacts']['library'],
  },
  schedules: {
    list: invoke(Channels.schedulesList) as DshApi['schedules']['list'],
    save: invoke(Channels.schedulesSave) as DshApi['schedules']['save'],
    remove: invoke(Channels.schedulesRemove) as DshApi['schedules']['remove'],
    runNow: invoke(Channels.schedulesRunNow) as DshApi['schedules']['runNow'],
  },
  changes: {
    revertAll: invoke(Channels.changesRevertAll) as DshApi['changes']['revertAll'],
    commit: invoke(Channels.changesCommit) as DshApi['changes']['commit'],
  },
  openExternal: invoke(Channels.openExternal) as DshApi['openExternal'],
  onEvent(listener) {
    const wrapped = (_event: unknown, payload: AgentEvent) => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, wrapped)
  },
}

contextBridge.exposeInMainWorld('dsh', api)
