// Artifacts: standalone content the agent makes for the person (a page, a diagram, a document),
// shown beside the conversation instead of written into the project. Every change is a new version.

import type { ArtifactType, ArtifactVersion } from '../../shared/types'
import type { ToolSpec } from '../deepseek'
import { ToolError } from './paths'

export const ARTIFACT_TYPES: ArtifactType[] = ['html', 'react', 'svg', 'mermaid', 'markdown', 'code']
const MAX_CONTENT = 400_000
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const VIEW_LINES = 2000
const VIEW_LINE_LENGTH = 2000

export const ARTIFACT_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'artifact',
    description: `Show the user a standalone piece of content in a panel beside the chat, without touching the project's files. Use it when the user asks for something to look at or use on its own: a small web page, tool or game (html), an interactive component (react), an image or illustration (svg), a flowchart, sequence or other diagram (mermaid), a longer document (markdown), or code they will copy elsewhere (code). Do not use it for changes to the project; edit the files instead, and do not use it for short answers.
- create: a new artifact. Give it a short kebab-case id, a title, a type and the full content.
- update: change part of an existing artifact. old_str must match its latest version exactly once; new_str replaces it.
- rewrite: replace the whole content of an existing artifact. It may also change the type.
- view: read the latest version with line numbers. Do this before an update when the content is not in front of you.
Each call except view makes a new version the user can step back through. To change an artifact, update it rather than creating another.
Your reply has an output limit, and a call that runs past it is cut off and fails. For a large page, create a working first version and add to it with update.
The preview runs offline apart from a few code CDNs: it cannot fetch data or load images from other sites, so draw with SVG or CSS and keep data inline.
html: one complete page with its CSS and JavaScript inline. Scripts may load from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or esm.sh.
react: one module whose default export is a component that takes no props. Import React hooks from "react"; Tailwind classes work; other packages are loaded from esm.sh.
svg: a single <svg> element with a viewBox.
mermaid: Mermaid diagram source only, without a code fence.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['create', 'update', 'rewrite', 'view'] },
        id: { type: 'string', description: 'Short kebab-case id, such as "pomodoro-timer".' },
        title: { type: 'string', description: 'A few words naming the artifact, in the language the user writes in. Required for create.' },
        type: { type: 'string', enum: ARTIFACT_TYPES, description: 'Required for create. For rewrite, only to change the type.' },
        language: { type: 'string', description: 'For type "code": the language, such as "python".' },
        content: { type: 'string', description: 'The full content, for create and rewrite.' },
        old_str: { type: 'string', description: 'For update: the exact text to replace.' },
        new_str: { type: 'string', description: 'For update: the text to put in its place.' },
        offset: { type: 'integer', description: 'For view: the first line to read, starting at 1.' },
        limit: { type: 'integer', description: 'For view: how many lines to read.' },
      },
      required: ['command', 'id'],
    },
  },
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

function checkType(value: unknown): ArtifactType {
  const type = text(value) as ArtifactType | undefined
  if (!type || !ARTIFACT_TYPES.includes(type)) throw new ToolError(`"type" must be one of: ${ARTIFACT_TYPES.join(', ')}.`)
  return type
}

/** The language a version keeps: only code has one, and a rewrite keeps the old one unless it names another. */
function languageFor(type: ArtifactType, given: unknown, previous?: ArtifactVersion): string | undefined {
  if (type !== 'code') return undefined
  return text(given)?.trim() || (previous?.type === 'code' ? previous.language : undefined)
}

const withLanguage = (language: string | undefined) => (language ? { language } : {})

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
    const type = checkType(args.type)
    const title = text(args.title)?.trim()
    if (!title) throw new ToolError('"title" must not be empty.')
    return { id, title: title.slice(0, 80), type, ...withLanguage(languageFor(type, args.language)), content: checkContent(text(args.content)), version: 1 }
  }

  if (command !== 'update' && command !== 'rewrite') throw new ToolError('"command" must be create, update, rewrite or view.')
  if (!previous) throw new ToolError(`There is no artifact called "${id}". Create it first.`)
  const title = text(args.title)?.trim().slice(0, 80) || previous.title
  const version = previous.version + 1

  if (command === 'rewrite') {
    const type = args.type === undefined ? previous.type : checkType(args.type)
    return { id, title, type, ...withLanguage(languageFor(type, args.language, previous)), content: checkContent(text(args.content)), version }
  }

  // An update edits the text in place, so the kind of artifact stays what it was.
  const oldStr = text(args.old_str)
  const newStr = text(args.new_str)
  if (!oldStr) throw new ToolError('"old_str" must not be empty.')
  if (newStr === undefined) throw new ToolError('"new_str" is missing.')
  const at = previous.content.indexOf(oldStr)
  if (at === -1) throw new ToolError(`"old_str" was not found in the latest version of "${id}". Call view to see it, then match it exactly, including indentation.`)
  if (previous.content.indexOf(oldStr, at + 1) !== -1) throw new ToolError('"old_str" appears more than once. Include more of the surrounding text so it is unique.')
  return { ...previous, title, version, content: checkContent(previous.content.slice(0, at) + newStr + previous.content.slice(at + oldStr.length)) }
}

const lineArg = (value: unknown, fallback: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), max) : fallback

/** The latest version of an artifact with numbered lines, for the model to read before it edits. */
export function viewArtifact(args: Record<string, unknown>, latest: (id: string) => ArtifactVersion | undefined): { artifact: ArtifactVersion; text: string; lines: number } {
  const id = text(args.id)?.trim() ?? ''
  const artifact = ID.test(id) ? latest(id) : undefined
  if (!artifact) throw new ToolError(`There is no artifact called "${id}".`)
  const all = artifact.content.split('\n')
  if (artifact.content.endsWith('\n')) all.pop()
  const offset = lineArg(args.offset, 1, Math.max(1, all.length))
  const slice = all.slice(offset - 1, offset - 1 + lineArg(args.limit, VIEW_LINES, VIEW_LINES))
  const end = offset + slice.length - 1
  const width = String(end).length
  const body = slice.map((line, i) => `${String(offset + i).padStart(width)}\t${line.length > VIEW_LINE_LENGTH ? `${line.slice(0, VIEW_LINE_LENGTH)} [line truncated]` : line}`).join('\n')
  const header = `"${artifact.id}" (${artifact.title}), ${artifact.type}${artifact.language ? ` ${artifact.language}` : ''}, version ${artifact.version}, lines ${offset}-${end} of ${all.length}`
  const footer = end < all.length ? `\n\n[${all.length - end} more lines. Call view again with offset ${end + 1} to continue.]` : ''
  return { artifact, text: `${header}\n${body}${footer}`, lines: slice.length }
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

/** The command of a call that is still streaming in, once it has been written out in full. */
export function streamedCommand(json: string): 'create' | 'update' | 'rewrite' | 'view' | undefined {
  const match = /"command"\s*:\s*"(create|update|rewrite|view)"/.exec(json)
  return match ? (match[1] as 'create' | 'update' | 'rewrite' | 'view') : undefined
}

/** The id of a call that is still streaming in, once its closing quote has arrived; a prefix could name another artifact. */
export function streamedId(json: string): string | undefined {
  const match = /"id"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(json)
  if (!match) return undefined
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim()
  } catch {
    return undefined
  }
}

/**
 * The artifact as far as it has streamed in, for the panel to show while the agent writes it.
 * It follows the same rules as nextArtifact, so the finished version looks like the draft did.
 */
export function draftArtifact(json: string, latest: (id: string) => ArtifactVersion | undefined): ArtifactVersion {
  // Trimmed as nextArtifact trims it, so the draft carries the id the version will have.
  const id = partialField(json, 'id')?.trim() ?? ''
  const previous = id ? latest(id) : undefined
  const command = streamedCommand(json)
  const named = partialField(json, 'type') as ArtifactType | undefined
  const given = named && ARTIFACT_TYPES.includes(named) ? named : undefined
  const type = command === 'update' ? (previous?.type ?? 'code') : (given ?? previous?.type ?? 'code')
  const language = command === 'update' ? previous?.language : languageFor(type, partialField(json, 'language'), command === 'rewrite' ? previous : undefined)
  const title = partialField(json, 'title') || previous?.title || ''
  const content = command === 'update' ? (previous?.content ?? '') : (partialField(json, 'content') ?? previous?.content ?? '')
  return { id, title, type, ...withLanguage(language), content, version: (previous?.version ?? 0) + 1 }
}
