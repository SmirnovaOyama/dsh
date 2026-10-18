// Keeps every file tool inside the workspace folder, including through symlinks.

import { realpath } from 'node:fs/promises'
import path from 'node:path'

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export interface ResolvedPath {
  /** Absolute path on disk. */
  abs: string
  /** Path relative to the workspace, with forward slashes, for display and for the model. */
  rel: string
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Resolves the deepest existing ancestor through symlinks, then re-appends the rest. */
async function realpathLoose(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      const real = await realpath(current)
      return missing.length ? path.join(real, ...missing.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return target
      missing.push(path.basename(current))
      current = parent
    }
  }
}

export async function resolveInWorkspace(workspace: string, input: unknown): Promise<ResolvedPath> {
  if (typeof input !== 'string' || !input.trim()) throw new ToolError('A path is required.')
  const raw = input.trim()
  const abs = path.resolve(workspace, raw)
  if (!isInside(workspace, abs)) {
    throw new ToolError(`"${raw}" is outside the workspace. Only files inside ${workspace} can be used.`)
  }
  const [realRoot, realTarget] = await Promise.all([realpathLoose(workspace), realpathLoose(abs)])
  if (!isInside(realRoot, realTarget)) {
    throw new ToolError(`"${raw}" points outside the workspace through a symlink.`)
  }
  return { abs, rel: toRel(workspace, abs) }
}

export function toRel(workspace: string, abs: string): string {
  const rel = path.relative(workspace, abs)
  return (rel || '.').split(path.sep).join('/')
}

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.gradle',
  'Pods',
  'DerivedData',
])
