// Artifacts: standalone content the agent makes for the person (a page, a diagram, a document),
// shown beside the conversation instead of written into the project. Every change is a new version.

import type { ArtifactType, ArtifactVersion } from '../../shared/types'
import type { ToolSpec } from '../deepseek'
import { ToolError } from './paths'

export const ARTIFACT_TYPES: ArtifactType[] = ['html', 'react', 'svg', 'markdown', 'code']
const MAX_CONTENT = 400_000
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export const ARTIFACT_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'artifact',
    description: `Show the user a standalone piece of content in a panel beside the chat, without touching the project's files. Use it when the user asks for something to look at or use on its own: a small web page, tool or game (html), an interactive component (react), an image or diagram (svg), a longer document (markdown), or code they will copy elsewhere (code). Do not use it for changes to the project; edit the files instead, and do not use it for short answers.
- create: a new artifact. Give it a short kebab-case id, a title, a type and the full content.
- update: change part of an existing artifact. old_str must match its latest version exactly once; new_str replaces it.
- rewrite: replace the whole content of an existing artifact.
Each call makes a new version the user can step back through. To change an artifact, update it rather than creating another.
html: one complete page with its CSS and JavaScript inline. Scripts may load from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or esm.sh.
react: one module whose default export is a component that takes no props. Import React hooks from "react"; Tailwind classes work; other packages are loaded from esm.sh.
svg: a single <svg> element with a viewBox.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['create', 'update', 'rewrite'] },
        id: { type: 'string', description: 'Short kebab-case id, such as "pomodoro-timer".' },
        title: { type: 'string', description: 'A few words naming the artifact, in the language the user writes in. Required for create.' },
        type: { type: 'string', enum: ARTIFACT_TYPES, description: 'Required for create.' },
        language: { type: 'string', description: 'For type "code": the language, such as "python".' },
        content: { type: 'string', description: 'The full content, for create and rewrite.' },
        old_str: { type: 'string', description: 'For update: the exact text to replace.' },
        new_str: { type: 'string', description: 'For update: the text to put in its place.' },
      },
      required: ['command', 'id'],
    },
  },
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

function checkContent(content: string | undefined): string {
  if (content === undefined || !content.trim()) throw new ToolError('"content" must not be empty.')
  if (content.length > MAX_CONTENT) throw new ToolError(`"content" is longer than ${MAX_CONTENT} characters. Make the artifact smaller.`)
  return content
}

/** Works out the new version from the call's arguments and the artifact's latest version. */
export function nextArtifact(args: Record<string, unknown>, latest: (id: string) => ArtifactVersion | undefined): ArtifactVersion {
  const command = text(args.command)
  const id = text(args.id)?.trim() ?? ''
  if (!ID.test(id)) throw new ToolError('"id" must be a short kebab-case name such as "pomodoro-timer".')
  const previous = latest(id)

  if (command === 'create') {
    if (previous) throw new ToolError(`An artifact called "${id}" already exists. Use update or rewrite to change it, or pick another id.`)
    const type = text(args.type) as ArtifactType | undefined
    if (!type || !ARTIFACT_TYPES.includes(type)) throw new ToolError(`"type" must be one of: ${ARTIFACT_TYPES.join(', ')}.`)
    const title = text(args.title)?.trim()
    if (!title) throw new ToolError('"title" must not be empty.')
    const language = type === 'code' ? text(args.language)?.trim() || undefined : undefined
    return { id, title: title.slice(0, 80), type, ...(language ? { language } : {}), content: checkContent(text(args.content)), version: 1 }
  }

  if (command !== 'update' && command !== 'rewrite') throw new ToolError('"command" must be create, update or rewrite.')
  if (!previous) throw new ToolError(`There is no artifact called "${id}". Create it first.`)
  const title = text(args.title)?.trim().slice(0, 80) || previous.title
  const base = { ...previous, title, version: previous.version + 1 }

  if (command === 'rewrite') return { ...base, content: checkContent(text(args.content)) }

  const oldStr = text(args.old_str)
  const newStr = text(args.new_str)
  if (!oldStr) throw new ToolError('"old_str" must not be empty.')
  if (newStr === undefined) throw new ToolError('"new_str" is missing.')
  const at = previous.content.indexOf(oldStr)
  if (at === -1) throw new ToolError(`"old_str" was not found in the latest version of "${id}". Match it exactly, including indentation.`)
  if (previous.content.indexOf(oldStr, at + 1) !== -1) throw new ToolError('"old_str" appears more than once. Include more of the surrounding text so it is unique.')
  return { ...base, content: checkContent(previous.content.slice(0, at) + newStr + previous.content.slice(at + oldStr.length)) }
}

/**
 * Reads a string field out of tool arguments that are still streaming in, so the panel can show
 * an artifact while it is being written. Returns undefined until the field starts.
 */
export function partialField(json: string, key: string): string | undefined {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(json)
  if (!start) return undefined
  let out = ''
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const ch = json[i]
    if (ch === '"') return out
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = json[i + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) break
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
      continue
    }
    out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next === 'b' ? '\b' : next === 'f' ? '\f' : next
    i++
  }
  return out
}

/** The artifact as far as it has streamed in, for the panel to show while the agent writes it. */
export function draftArtifact(json: string, latest: (id: string) => ArtifactVersion | undefined): ArtifactVersion {
  const id = partialField(json, 'id') ?? ''
  const previous = id ? latest(id) : undefined
  const command = partialField(json, 'command')
  const type = (partialField(json, 'type') as ArtifactType | undefined) ?? previous?.type ?? 'code'
  const title = partialField(json, 'title') || previous?.title || ''
  const content = command === 'update' ? (previous?.content ?? '') : (partialField(json, 'content') ?? previous?.content ?? '')
  const language = partialField(json, 'language') ?? previous?.language
  return {
    id,
    title,
    type: ARTIFACT_TYPES.includes(type) ? type : 'code',
    ...(language ? { language } : {}),
    content,
    version: (previous?.version ?? 0) + 1,
  }
}
