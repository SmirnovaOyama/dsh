// Decides whether a tool call needs the person's approval before it runs.

import type { PermissionMode } from '../shared/types'
import type { PermissionNeed } from './tools'
import { isCommandAllowed } from './tools/shell'

export interface PermissionContext {
  mode: PermissionMode
  allowedCommands: string[]
  /** "Allow for this conversation" was chosen for an edit earlier in the session. */
  sessionAllowsEdits: boolean
  sessionCommandPrefixes: string[]
}

export function needsApproval(need: PermissionNeed, ctx: PermissionContext): boolean {
  if (ctx.mode === 'auto') return false
  if (need.kind === 'edit') return ctx.mode === 'ask' && !ctx.sessionAllowsEdits
  return !isCommandAllowed(need.command, [...ctx.allowedCommands, ...ctx.sessionCommandPrefixes])
}
