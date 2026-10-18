// Files and line ranges the person points at. They travel with a message and are read fresh from
// disk when it is sent, so the agent sees the file as it is now.

import type { FileRef } from '../shared/types'
import { readTextFile } from './tools/files'
import { resolveInWorkspace } from './tools/paths'

const MAX_REFS = 20
const MAX_REF_LINES = 400
const MAX_REF_CHARS = 40_000

/** Keeps only well-formed references, since they arrive from the renderer. */
export function cleanRefs(input: unknown): FileRef[] {
  if (!Array.isArray(input)) return []
  const refs: FileRef[] = []
  for (const item of input.slice(0, MAX_REFS)) {
    if (!item || typeof item !== 'object') continue
    const { path, start, end } = item as Record<string, unknown>
    if (typeof path !== 'string' || !path.trim()) continue
    const line = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined)
    const from = line(start)
    const to = line(end)
    refs.push(from ? { path, start: from, end: Math.max(from, to ?? from) } : { path })
  }
  return refs
}

function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(longest + 1)
}

async function renderRef(workspace: string, ref: FileRef): Promise<string> {
  let text: string
  try {
    text = await readTextFile(await resolveInWorkspace(workspace, ref.path))
  } catch (error) {
    return `${ref.path}: could not be read (${error instanceof Error ? error.message : String(error)})`
  }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const first = ref.start ? Math.min(ref.start, Math.max(lines.length, 1)) : 1
  const wanted = ref.start ? Math.min(ref.end ?? ref.start, lines.length) : lines.length
  const last = Math.min(wanted, first + MAX_REF_LINES - 1)
  const width = String(last).length
  let body = lines
    .slice(first - 1, last)
    .map((line, i) => `${String(first + i).padStart(width)}  ${line}`)
    .join('\n')
  if (body.length > MAX_REF_CHARS) body = `${body.slice(0, MAX_REF_CHARS)}\n[cut here, the rest is longer than this message allows]`
  const range = ref.start ? `, lines ${first}-${last}` : lines.length > last ? `, lines 1-${last} of ${lines.length}` : ''
  const more = wanted > last ? `\n[${wanted - last} more lines not included; read the file to see them]` : ''
  const tick = fence(body)
  return `${ref.path}${range}:\n${tick}\n${body}\n${tick}${more}`
}

/** The message the model sees: what the person wrote, then each file they pointed at. */
export async function withRefs(workspace: string, text: string, refs: FileRef[]): Promise<string> {
  if (!refs.length) return text
  const parts = await Promise.all(refs.map((ref) => renderRef(workspace, ref)))
  return `${text}\n\nThe person pointed at these parts of the project:\n\n${parts.join('\n\n')}`
}
