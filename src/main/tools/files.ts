// Read-only file tools and the preparation step of the two tools that write.

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { IGNORED_DIRS, ToolError, resolveInWorkspace, toRel, type ResolvedPath } from './paths'

const run = promisify(execFile)

const MAX_READ_LINES = 2000
const MAX_LINE_LENGTH = 2000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LIST_ENTRIES = 500
const MAX_FIND_RESULTS = 500
const MAX_SEARCH_MATCHES = 200
const MAX_WALK_FILES = 20_000

export interface ToolOutput {
  /** What the model reads. */
  text: string
  lines?: number
  matches?: number
  files?: number
  truncated?: boolean
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new ToolError(`"${name}" must be a string.`)
  return value
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000)
  return sample.includes(0)
}

export async function readTextFile(target: ResolvedPath): Promise<string> {
  let info
  try {
    info = await stat(target.abs)
  } catch {
    throw new ToolError(`${target.rel} does not exist.`)
  }
  if (info.isDirectory()) throw new ToolError(`${target.rel} is a folder. Use list_dir to see what is inside.`)
  if (info.size > MAX_FILE_BYTES) throw new ToolError(`${target.rel} is larger than 2 MB, which is too big to read here.`)
  const buffer = await readFile(target.abs)
  if (isBinary(buffer)) throw new ToolError(`${target.rel} looks like a binary file.`)
  return buffer.toString('utf8')
}

export async function readFileTool(workspace: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const target = await resolveInWorkspace(workspace, args.path)
  const text = await readTextFile(target)
  const all = text.split('\n')
  if (text.endsWith('\n')) all.pop()
  const offset = int(args.offset, 1, 1, Math.max(1, all.length))
  const limit = int(args.limit, MAX_READ_LINES, 1, MAX_READ_LINES)
  const slice = all.slice(offset - 1, offset - 1 + limit)
  const width = String(offset + slice.length - 1).length
  const body = slice
    .map((line, i) => {
      const clipped = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + ' [line truncated]' : line
      return `${String(offset + i).padStart(width)}\t${clipped}`
    })
    .join('\n')
  const end = offset + slice.length - 1
  const truncated = end < all.length
  const header = all.length === 0 ? `${target.rel} is empty.` : `${target.rel}, lines ${offset}-${end} of ${all.length}`
  const footer = truncated ? `\n\n[${all.length - end} more lines. Call read_file again with offset ${end + 1} to continue.]` : ''
  return { text: `${header}\n${body}${footer}`, lines: slice.length, truncated }
}

export async function listDirTool(workspace: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const target = await resolveInWorkspace(workspace, args.path ?? '.')
  const depth = int(args.depth, 2, 1, 5)
  const out: string[] = []
  let truncated = false

  async function walk(dir: string, level: number, indent: string) {
    if (out.length >= MAX_LIST_ENTRIES) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      throw new ToolError(`${toRel(workspace, dir)} is not a folder that can be read.`)
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (out.length >= MAX_LIST_ENTRIES) {
        truncated = true
        return
      }
      if (entry.isDirectory()) {
        const skipped = IGNORED_DIRS.has(entry.name)
        out.push(`${indent}${entry.name}/${skipped ? ' (skipped)' : ''}`)
        if (!skipped && level < depth) await walk(path.join(dir, entry.name), level + 1, indent + '  ')
      } else {
        out.push(`${indent}${entry.name}`)
      }
    }
  }

  await walk(target.abs, 1, '')
  const text = out.length ? out.join('\n') : `${target.rel} is empty.`
  return { text: `${target.rel}/\n${text}${truncated ? '\n[List truncated at 500 entries.]' : ''}`, files: out.length, truncated }
}

/** Converts a glob such as `src/**\/*.{ts,tsx}` into a regular expression over forward-slash paths. */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  let i = 0
  let inGroup = false
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        source += slash ? '(?:.*/)?' : '.*'
        i += slash ? 3 : 2
        continue
      }
      source += '[^/]*'
    } else if (c === '?') {
      source += '[^/]'
    } else if (c === '{') {
      inGroup = true
      source += '(?:'
    } else if (c === '}' && inGroup) {
      inGroup = false
      source += ')'
    } else if (c === ',' && inGroup) {
      source += '|'
    } else {
      source += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
    }
    i++
  }
  // A pattern without a slash matches the file name at any depth, the way people expect `*.ts` to work.
  const anywhere = !glob.includes('/')
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${source}$`)
}

/** Files under `sub`, relative to the workspace. Uses git when possible so .gitignore is respected. */
export async function listWorkspaceFiles(workspace: string, sub: ResolvedPath): Promise<{ files: string[]; truncated: boolean }> {
  try {
    const { stdout } = await run('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', sub.rel === '.' ? '.' : sub.rel], {
      cwd: workspace,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15_000,
    })
    const files = stdout.split('\0').filter(Boolean)
    if (files.length) return { files: files.slice(0, MAX_WALK_FILES), truncated: files.length > MAX_WALK_FILES }
  } catch {
    // Not a git repository, or git is not installed: walk the folder instead.
  }
  const files: string[] = []
  let truncated = false
  async function walk(dir: string) {
    if (files.length >= MAX_WALK_FILES) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(abs)
      } else if (entry.isFile()) {
        files.push(toRel(workspace, abs))
        if (files.length >= MAX_WALK_FILES) {
          truncated = true
          return
        }
      }
    }
  }
  await walk(sub.abs)
  return { files, truncated }
}

export async function findFilesTool(workspace: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const pattern = str(args.pattern, 'pattern').trim()
  if (!pattern) throw new ToolError('"pattern" must not be empty.')
  const sub = await resolveInWorkspace(workspace, args.path ?? '.')
  const regex = globToRegExp(pattern)
  const { files, truncated: walkTruncated } = await listWorkspaceFiles(workspace, sub)
  const prefix = sub.rel === '.' ? '' : sub.rel + '/'
  const matched = files.filter((file) => regex.test(file.startsWith(prefix) ? file.slice(prefix.length) : file))
  const shown = matched.slice(0, MAX_FIND_RESULTS)
  const truncated = walkTruncated || matched.length > shown.length
  const text = shown.length
    ? shown.join('\n') + (truncated ? `\n[Showing ${shown.length} of ${matched.length}${walkTruncated ? '+' : ''} files.]` : '')
    : `No files match ${pattern}.`
  return { text, files: matched.length, truncated }
}

export async function searchFilesTool(workspace: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const pattern = str(args.pattern, 'pattern')
  if (!pattern) throw new ToolError('"pattern" must not be empty.')
  let regex: RegExp
  try {
    regex = new RegExp(pattern, args.ignore_case === true ? 'i' : '')
  } catch (error) {
    throw new ToolError(`"${pattern}" is not a valid regular expression: ${(error as Error).message}`)
  }
  const sub = await resolveInWorkspace(workspace, args.path ?? '.')
  const include = typeof args.glob === 'string' && args.glob.trim() ? globToRegExp(args.glob.trim()) : null

  let candidates: string[]
  try {
    const info = await stat(sub.abs)
    candidates = info.isFile() ? [sub.rel] : (await listWorkspaceFiles(workspace, sub)).files
  } catch {
    throw new ToolError(`${sub.rel} does not exist.`)
  }

  const results: string[] = []
  const fileSet = new Set<string>()
  let matches = 0
  for (const rel of candidates) {
    if (include && !include.test(rel)) continue
    const abs = path.join(workspace, ...rel.split('/'))
    let buffer: Buffer
    try {
      const info = await stat(abs)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
      buffer = await readFile(abs)
    } catch {
      continue
    }
    if (isBinary(buffer)) continue
    const lines = buffer.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue
      matches++
      fileSet.add(rel)
      if (results.length < MAX_SEARCH_MATCHES) {
        const line = lines[i].length > 300 ? lines[i].slice(0, 300) + ' [line truncated]' : lines[i]
        results.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    }
  }
  const truncated = matches > results.length
  const text = results.length
    ? results.join('\n') + (truncated ? `\n[Showing ${results.length} of ${matches} matches.]` : '')
    : `No matches for /${pattern}/.`
  return { text, matches, files: fileSet.size, truncated }
}

export interface PreparedWrite {
  target: ResolvedPath
  before: string | null
  after: string
  replacements?: number
}

async function readExisting(target: ResolvedPath): Promise<string | null> {
  try {
    const info = await stat(target.abs)
    if (info.isDirectory()) throw new ToolError(`${target.rel} is a folder.`)
  } catch (error) {
    if (error instanceof ToolError) throw error
    return null
  }
  return readTextFile(target)
}

export async function prepareWriteFile(workspace: string, args: Record<string, unknown>): Promise<PreparedWrite> {
  const target = await resolveInWorkspace(workspace, args.path)
  const content = str(args.content, 'content')
  const before = await readExisting(target)
  return { target, before, after: content }
}

export async function prepareEditFile(workspace: string, args: Record<string, unknown>): Promise<PreparedWrite> {
  const target = await resolveInWorkspace(workspace, args.path)
  const oldString = str(args.old_string, 'old_string')
  const newString = str(args.new_string, 'new_string')
  const replaceAll = args.replace_all === true
  if (oldString === newString) throw new ToolError('old_string and new_string are the same, so there is nothing to change.')
  const before = await readExisting(target)
  if (before === null) throw new ToolError(`${target.rel} does not exist. Use write_file to create it.`)
  if (oldString === '') throw new ToolError('old_string must not be empty. Use write_file to replace a whole file.')

  // Models often send \n while the file uses \r\n; match either way, then keep the file's own endings.
  const crlf = before.includes('\r\n')
  const find = crlf && !oldString.includes('\r\n') ? oldString.replace(/\n/g, '\r\n') : oldString
  const replacement = crlf && !newString.includes('\r\n') ? newString.replace(/\n/g, '\r\n') : newString

  const count = before.split(find).length - 1
  if (count === 0) {
    throw new ToolError(`old_string was not found in ${target.rel}. Read the file again and copy the text exactly, including spaces and indentation.`)
  }
  if (count > 1 && !replaceAll) {
    throw new ToolError(`old_string appears ${count} times in ${target.rel}. Add more surrounding lines so it is unique, or set replace_all to true.`)
  }
  const after = replaceAll ? before.split(find).join(replacement) : before.replace(find, () => replacement)
  return { target, before, after, replacements: replaceAll ? count : 1 }
}
