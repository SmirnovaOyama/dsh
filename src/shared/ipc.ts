// IPC channel names. Every invoke channel maps to one method of DshApi.

export const EVENT_CHANNEL = 'dsh:event'

export const Channels = {
  initialState: 'dsh:initial-state',
  settingsUpdate: 'dsh:settings:update',
  settingsSetKey: 'dsh:settings:set-key',
  settingsClearKey: 'dsh:settings:clear-key',
  settingsRevealKey: 'dsh:settings:reveal-key',
  settingsTest: 'dsh:settings:test',
  workspacePick: 'dsh:workspace:pick',
  workspaceOpen: 'dsh:workspace:open',
  sessionsList: 'dsh:sessions:list',
  sessionsLoad: 'dsh:sessions:load',
  sessionsRemove: 'dsh:sessions:remove',
  agentStart: 'dsh:agent:start',
  agentSend: 'dsh:agent:send',
  agentStop: 'dsh:agent:stop',
  agentRetry: 'dsh:agent:retry',
  agentRespond: 'dsh:agent:respond',
  agentConfigure: 'dsh:agent:configure',
  changesRevertAll: 'dsh:changes:revert-all',
  changesCommit: 'dsh:changes:commit',
  openExternal: 'dsh:open-external',
} as const
