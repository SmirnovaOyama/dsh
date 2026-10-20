// What the composer offers while typing: slash commands at the start of a message, and files after @.

import type { SlashCommand } from '../shared/types'

export type Trigger = { kind: 'slash' | 'file'; query: string; start: number; end: number }

/**
 * The trigger the caret is in, if any. `/` counts only at the very start of the message, `@` only at
 * the start of a word, and both end at the first space.
 */
export function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)
  const slash = /^\/([\w.-]*)$/.exec(before)
  if (slash) return { kind: 'slash', query: slash[1], start: 0, end: caret }
  const at = /(^|\s)@([^\s@]*)$/.exec(before)
  if (at) {
    const start = caret - at[2].length - 1
    // The rest of the word after the caret belongs to the query too, so it is replaced along with it.
    const rest = /^[^\s@]*/.exec(text.slice(caret))?.[0] ?? ''
    return { kind: 'file', query: at[2], start, end: caret + rest.length }
  }
  return null
}

export type CommandKind = 'prompt' | 'action'

export interface CommandEntry extends SlashCommand {
  /** `action` commands do something in the app; `prompt` ones send a message to the agent. */
  kind: CommandKind
  /** Shown after the name, like "[重點]". */
  hint?: string
  custom?: boolean
}

export function filterCommands(commands: CommandEntry[], query: string): CommandEntry[] {
  const q = query.toLowerCase()
  if (!q) return commands
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  return [...starts, ...contains]
}

/**
 * Scores a path against what was typed, higher is better, or -1 when the letters are not all there in
 * order. Matches in the file name beat matches in folders, and runs of letters beat scattered ones.
 */
export function scorePath(path: string, query: string): number {
  if (!query) return 0
  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const nameStart = p.lastIndexOf('/') + 1
  const name = p.slice(nameStart)
  if (name === q) return 1000
  if (name.startsWith(q)) return 800 - name.length
  const inName = name.indexOf(q)
  if (inName !== -1) return 600 - inName - name.length / 10
  const inPath = p.indexOf(q)
  if (inPath !== -1) return 400 - inPath / 10
  let score = 0
  let from = 0
  let last = -2
  for (const ch of q) {
    const at = p.indexOf(ch, from)
    if (at === -1) return -1
    score += at === last + 1 ? 6 : 1
    if (at >= nameStart) score += 2
    last = at
    from = at + 1
  }
  return score
}

export function filterFiles(files: string[], query: string, limit = 8): string[] {
  if (!query) return files.slice(0, limit)
  let scored: Array<[string, number]> = []
  for (const file of files) {
    const score = scorePath(file, query)
    if (score >= 0) scored.push([file, score])
  }
  // Once the letters appear together somewhere, scattered matches are noise.
  if (scored.some(([, score]) => score >= 400)) scored = scored.filter(([, score]) => score >= 400)
  scored.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
  return scored.slice(0, limit).map(([file]) => file)
}
