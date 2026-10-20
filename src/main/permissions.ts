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
  if (need.kind === 'plan') return true
  if (ctx.mode === 'auto') return false
  if (need.kind === 'edit') return ctx.mode === 'ask' && !ctx.sessionAllowsEdits
  return !isCommandAllowed(need.command, [...ctx.allowedCommands, ...ctx.sessionCommandPrefixes])
}

/**
 * In plan mode nothing changes: edits are refused, and so are commands unless they are on the allowed
 * list (which holds read-only ones such as git status by default). Returns why, or null to go ahead.
 */
export function planModeRefusal(need: PermissionNeed, ctx: PermissionContext): string | null {
  if (ctx.mode !== 'plan' || need.kind === 'plan') return null
  if (need.kind === 'command' && isCommandAllowed(need.command, [...ctx.allowedCommands, ...ctx.sessionCommandPrefixes])) return null
  return need.kind === 'edit'
    ? 'Not done: plan mode is on, so files cannot be changed yet. Keep reading, then call exit_plan_mode with your plan.'
    : 'Not run: plan mode is on, and only read-only commands from the allowed list can run. Keep reading, then call exit_plan_mode with your plan.'
}
