// Compacting: when the context is nearly full, the model writes a summary of the session and the
// summary replaces the messages it sees. The transcript on screen keeps everything.

import { contextWindow } from '../shared/types'
import type { ChatMessage } from './deepseek'

/** Compact before a request once the previous one used this much of the context window. */
export function compactAt(model: string): number {
  return Math.round(contextWindow(model) * 0.8)
}

const TOOL_RESULT_CHARS = 2_000
const TOOL_ARGS_CHARS = 1_000
const FOCUS_CHARS = 2_000

const SUMMARY_INTRO = 'This session continues from an earlier conversation that was summarised to save context. The summary:'

export const COMPACT_SYSTEM =
  'You summarise a working session between a person and a coding agent. The agent will keep working from your summary alone, because the original messages are about to be removed.'

const COMPACT_REQUEST = `Write the summary now, in the language the person writes in, with these sections:

1. Requests: everything the person asked for, including later changes of mind. Quote their words where the exact wording matters.
2. Decisions and constraints: choices made, rules the person set, approaches that were rejected and why.
3. Files: each file that was read, created or changed, why it matters and its current state. Quote short pieces of code that later work depends on.
4. Errors and fixes: what went wrong and how it was resolved.
5. Done and pending: what is finished and what is still left to do.
6. Current work: exactly what was happening right before this summary, and the next step.

Keep paths, names, commands and numbers exact. Leave out anything you are unsure of rather than guessing. Do not call tools.`

const CONTINUE = 'Continue the work from where it stopped. Do not ask the person to repeat anything.'
const ACKNOWLEDGE = 'I have the summary and will continue from it.'

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)} [${text.length - max} more characters]`
}

/** The conversation as plain text, so the summary request needs no tool definitions and stays small. */
export function renderHistory(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      parts.push(m.content.startsWith(SUMMARY_INTRO) ? `## Earlier summary\n${m.content.slice(SUMMARY_INTRO.length).trim()}` : `## Person\n${m.content}`)
    } else if (m.role === 'assistant') {
      const lines = m.content ? [m.content] : []
      for (const call of m.tool_calls ?? []) lines.push(`[calls ${call.function.name} ${clip(call.function.arguments, TOOL_ARGS_CHARS)}]`)
      if (lines.length) parts.push(`## Agent\n${lines.join('\n')}`)
    } else if (m.role === 'tool') {
      parts.push(`## Tool result\n${clip(m.content, TOOL_RESULT_CHARS)}`)
    }
  }
  return parts.join('\n\n')
}

export function summaryRequest(messages: ChatMessage[], focus?: string): ChatMessage[] {
  const extra = focus?.trim() ? `\n\nThe person asked the summary to focus on: ${clip(focus.trim(), FOCUS_CHARS)}` : ''
  return [
    { role: 'system', content: COMPACT_SYSTEM },
    { role: 'user', content: `<conversation>\n${renderHistory(messages)}\n</conversation>\n\n${COMPACT_REQUEST}${extra}` },
  ]
}

/**
 * Splits the history for compacting. A trailing user message has not been answered yet, so it stays
 * out of the summary and is sent again after it.
 */
export function splitForCompact(messages: ChatMessage[]): { history: ChatMessage[]; held: ChatMessage | null } {
  const last = messages[messages.length - 1]
  if (last?.role === 'user') return { history: messages.slice(0, -1), held: last }
  return { history: messages, held: null }
}

/**
 * The messages that replace the history. Roles keep alternating: after a summary the model either
 * continues a turn that was cut short, or waits for the next message from the person.
 */
export function compactedMessages(summary: string, history: ChatMessage[], held: ChatMessage | null): ChatMessage[] {
  const intro = `${SUMMARY_INTRO}\n\n${summary}`
  const midTurn = !held && history[history.length - 1]?.role === 'tool'
  if (midTurn) return [{ role: 'user', content: `${intro}\n\n${CONTINUE}` }]
  const next: ChatMessage[] = [
    { role: 'user', content: intro },
    { role: 'assistant', content: ACKNOWLEDGE },
  ]
  return held ? [...next, held] : next
}

/** DeepSeek answers 400 when the prompt is longer than the model accepts. */
export function isContextOverflow(status: number | undefined, message: string): boolean {
  return status === 400 && /context length|maximum context|too many tokens|too long/i.test(message)
}
