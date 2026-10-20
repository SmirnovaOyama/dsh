// Custom slash commands: Markdown files in the project's .dsh/commands folder. Claude Code keeps
// them in .claude/commands, so that folder is read too and the same files work in both.
// `review.md` becomes /review; its text is the prompt, with $ARGUMENTS replaced by what follows.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SlashCommand } from '../shared/types'

const FOLDERS = ['.dsh/commands', '.claude/commands']
const MAX_COMMANDS = 100
const MAX_PROMPT = 20_000
const NAME = /^[\w.-]+$/

/** Names the app handles itself; a file with one of these names is left out. */
export const BUILT_IN_COMMANDS = ['compact', 'clear', 'init', 'review', 'plan', 'model', 'rewind']

/** Built-in commands that are prompts for the agent; the others act in the app. */
const BUILT_IN_PROMPTS: Record<string, string> = {
  init: `Look through this project and write an AGENTS.md file at its root for future coding agents. Cover, briefly and concretely:
- what the project is and how it is laid out
- the commands to install, build, run, test and lint, as they really are in this project
- the code style and conventions you can see in the code
- anything surprising a newcomer would trip over
If AGENTS.md already exists, improve it instead of starting over. Keep it short; leave out generic advice.`,
  review: `Review the changes in this project that are not committed yet (use git status and git diff; if this is not a git repository, review the files changed in this conversation). Look for bugs, missed edge cases, security problems and unclear code. List what you find, most serious first, each with path:line and a suggested fix. Do not change any files.`,
}

interface CommandFile extends SlashCommand {
  body: string
}

/** Splits off a `---` front matter block and reads its description. */
export function parseCommand(name: string, raw: string): CommandFile {
  let body = raw.replace(/^\uFEFF/, '')
  let description = ''
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body)
  if (front) {
    body = body.slice(front[0].length)
    const line = front[1].split(/\r?\n/).find((l) => /^description\s*:/.test(l))
    if (line) description = line.replace(/^description\s*:\s*/, '').replace(/^["']|["']$/g, '').trim()
  }
  if (!description) description = body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? ''
  return { name, description: description.slice(0, 120), body: body.trim().slice(0, MAX_PROMPT) }
}

async function readCommands(workspace: string): Promise<CommandFile[]> {
  const found = new Map<string, CommandFile>()
  for (const folder of FOLDERS) {
    let names: string[]
    try {
      names = await readdir(path.join(workspace, ...folder.split('/')))
    } catch {
      continue
    }
    for (const file of names.sort()) {
      if (!file.endsWith('.md') || found.size >= MAX_COMMANDS) continue
      const name = file.slice(0, -3)
      if (!NAME.test(name) || found.has(name) || BUILT_IN_COMMANDS.includes(name)) continue
      try {
        const command = parseCommand(name, await readFile(path.join(workspace, ...folder.split('/'), file), 'utf8'))
        if (command.body) found.set(name, command)
      } catch {
        // An unreadable file is simply not offered.
      }
    }
  }
  return [...found.values()]
}

export async function listCommands(workspace: string): Promise<SlashCommand[]> {
  return (await readCommands(workspace)).map(({ name, description }) => ({ name, description }))
}

/** The prompt for `/name args`, or null when the text does not start with a custom command. */
export async function expandCommand(workspace: string, text: string): Promise<{ name: string; prompt: string } | null> {
  const match = /^\/([\w.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const args = (match[2] ?? '').trim()
  const builtIn = BUILT_IN_PROMPTS[match[1]]
  if (builtIn) return { name: match[1], prompt: args ? `${builtIn}\n\nAlso: ${args}` : builtIn }
  const command = (await readCommands(workspace)).find((c) => c.name === match[1])
  if (!command) return null
  const prompt = command.body.includes('$ARGUMENTS')
    ? command.body.replaceAll('$ARGUMENTS', args)
    : args
      ? `${command.body}\n\n${args}`
      : command.body
  return { name: command.name, prompt }
}
